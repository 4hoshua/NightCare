// Teste dos trechos reais extraídos de sketch.ino; rede, NVS e relógio são doubles.
#include <atomic>
#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <string>
#include <vector>
#include <sys/time.h>

class String : public std::string {
 public:
  using std::string::string;
  using std::string::operator=;
  String(const std::string& value) : std::string(value) {}
  bool isEmpty() const { return empty(); }
  String& append(const char* value) { std::string::append(value); return *this; }
  String& append(const char* value, size_t n) { std::string::append(value, n); return *this; }
};
#include <ArduinoJson.h>

#define NIGHTCARE_DEVICE_ID "nightcare-001"
uint32_t tick = 0;
time_t utc = 1794580600;
uint32_t millis() { return tick; }
time_t fakeTime(time_t*) { return utc; }
#define time fakeTime
struct {
  template<class... Args> void printf(const char*, Args...) {}
  void println(const char*) {}
} Serial;
constexpr int WL_CONNECTED = 3, WIFI_STA = 1;
struct {
  int connection = WL_CONNECTED;
  int status() { return connection; }
  void mode(int) {}
  void setAutoReconnect(bool) {}
  void begin(const char*, const char*, int) {}
  void reconnect() {}
} WiFi;
void (*ntpCallback)(struct timeval*) = nullptr;
int syncRequests = 0;
void esp_sntp_set_sync_interval(uint32_t value) { assert(value >= 15000); }
void esp_sntp_set_time_sync_notification_cb(void (*cb)(struct timeval*)) { ntpCallback = cb; }
bool esp_sntp_restart() { ++syncRequests; return true; }
void configTzTime(const char* zone, const char*) { setenv("TZ", zone, 1); tzset(); }
bool networkPausedForTest = false;
std::atomic<uint32_t> ntpSyncGeneration{0};
struct { int utcOffset = -3, startMinute = 1320, endMinute = 360; } config;
#include "time-service.inc"

enum class AssistanceState { NONE, PENDING, ACKNOWLEDGED };
bool failSave = false;
int saveCount = 0;
String commandJournal = "[]";
struct {
  AssistanceState state = AssistanceState::PENDING;
  uint32_t pressCount = 1;
  char requestId[65] = "request-1";
  bool persisted = true;
  void save() { ++saveCount; persisted = !failSave; }
} assistance;
struct Ack { std::string id, status, reason; };
std::vector<Ack> acks;
std::vector<std::string> events;
void sendAck(JsonDocument& doc, const char* status, const char* reason) {
  acks.push_back({doc["commandId"] | "", status, reason});
}
void recordEvent(const char* type, const char*) { events.emplace_back(type); }
#include "command-handlers.inc"

std::string iso(time_t value) {
  char result[25]; struct tm t; gmtime_r(&value, &t);
  strftime(result, sizeof(result), "%Y-%m-%dT%H:%M:%SZ", &t);
  return result;
}
JsonDocument command(const char* id = "ack-1", const char* action = "ACK_HELP", time_t issued = 1794580620) {
  JsonDocument doc;
  doc["schemaVersion"] = 1; doc["deviceId"] = NIGHTCARE_DEVICE_ID;
  doc["commandId"] = id; doc["requestId"] = "request-1"; doc["action"] = action;
  doc["issuedAt"] = iso(issued); doc["expiresAt"] = iso(issued + 60);
  return doc;
}
void sync(time_t value) {
  utc = value; assert(ntpCallback); ntpCallback(nullptr);
  clockService.update(tick);
  updateWaitingCommands(tick);
}
void reset(bool preserveNvs = false) {
  tick = 0; utc = 1794580600; syncRequests = 0; ntpSyncGeneration = 0;
  WiFi.connection = WL_CONNECTED; networkPausedForTest = false;
  clockService = TimeService{}; clockService.begin(); clockService.update(tick);
  for (auto& waiting : waitingCommands) waiting = WaitingCommand{};
  waitingCommandCount = 0; failSave = false; saveCount = 0; acks.clear(); events.clear();
  if (!preserveNvs) {
    commandJournal = "[]"; assistance.state = AssistanceState::PENDING;
    assistance.pressCount = 1; strcpy(assistance.requestId, "request-1"); assistance.persisted = true;
  }
}
void expect(const char* reason, const char* status = "REJECTED") {
  assert(!acks.empty()); assert(acks.back().reason == reason); assert(acks.back().status == status);
}
int main() {
  // Boot completo: sem serial, relógio 20s atrás; nenhum efeito antes do NTP.
  reset(); assert(clockService.testMode == -1);
  utc = 0; clockService.update(tick); assert(!clockService.valid);
  sync(1794580600); assert(clockService.valid); // primeira sincronização automática do boot.
  auto doc = command(); applyRemoteCommand(doc, false, false);
  assert(waitingCommandCount == 1 && acks.empty() && saveCount == 0);
  tick = 14999; updateWaitingCommands(tick); assert(syncRequests == 0);
  tick = 15000; updateWaitingCommands(tick); assert(syncRequests == 1);
  applyRemoteCommand(doc, false, false); assert(waitingCommandCount == 1);
  assistance.pressCount = 2; // loop/entradas locais continuam disponíveis durante espera.
  sync(1794580630); expect("OK", "APPLIED");
  assert(assistance.state == AssistanceState::ACKNOWLEDGED && assistance.pressCount == 2);
  assert(saveCount == 1 && events.size() == 1 && waitingCommandCount == 0);
  applyRemoteCommand(doc, false, false); expect("ALREADY_APPLIED", "APPLIED"); assert(saveCount == 1);

  // Reinício do dispositivo: NVS conserva chamado/diário, RAM/fila e geração zeram.
  reset(true); applyRemoteCommand(doc, false, false); expect("ALREADY_APPLIED", "APPLIED");
  auto close = command("close-1", "CLOSE_HELP"); applyRemoteCommand(close, false, false);
  assert(waitingCommandCount == 1); sync(1794580631); expect("OK", "APPLIED");
  assert(assistance.state == AssistanceState::NONE && assistance.requestId[0] == '\0');

  // Replay do backend pode chegar antes da primeira resposta NTP do novo boot.
  reset(); utc = 0; clockService.update(tick); assert(!clockService.valid);
  doc = command(); applyRemoteCommand(doc, false, false);
  assert(acks.empty() && waitingCommandCount == 1);
  sync(1794580630); expect("OK", "APPLIED"); assert(saveCount == 1);

  // Demo exige amostra nova mesmo com hora aparentemente válida; UTC atrasado
  // não pode fazer um comando antigo, já expirado no mundo real, ser aplicado.
  reset(); utc = 1794580621; doc = command(); applyRemoteCommand(doc, false, false);
#if NIGHTCARE_DEMO
  assert(acks.empty() && waitingCommandCount == 1);
  updateWaitingCommands(tick); assert(acks.empty()); // geração anterior não libera.
  sync(1794580680); expect("EXPIRED_OR_INVALID_TIME"); assert(saveCount == 0);
#else
  expect("OK", "APPLIED"); assert(waitingCommandCount == 0);
#endif

  reset(); doc = command(); applyRemoteCommand(doc, false, false);
  sync(1794580614); expect("EXPIRED_OR_INVALID_TIME"); assert(waitingCommandCount == 0 && saveCount == 0);
  reset(); doc = command(); applyRemoteCommand(doc, false, false);
  sync(1794580615); expect("OK", "APPLIED"); // limite de 5s preservado.

  // Sem NTP, espera limitada; resposta tardia não aplica intenção descartada.
  reset(); doc = command(); applyRemoteCommand(doc, false, false);
  WiFi.connection = 0; tick = 29999; updateWaitingCommands(tick); assert(acks.empty() && syncRequests == 0);
  tick = 30000; updateWaitingCommands(tick); expect("CLOCK_SYNC_TIMEOUT");
  sync(1794580630); assert(saveCount == 0 && events.empty());

  // Pausa de rede não gera consultas; reconexão dispara recuperação automática.
  reset(); doc = command(); networkPausedForTest = true;
  applyRemoteCommand(doc, false, false); tick = 15000; updateWaitingCommands(tick); assert(syncRequests == 0);
  networkPausedForTest = false; updateWaitingCommands(tick); assert(syncRequests == 1);
  tick = 15001; updateWaitingCommands(tick); assert(syncRequests == 1);
  sync(1794580630); expect("OK", "APPLIED");

  // Guardas continuam a valer antes e depois da sincronização.
  reset(); doc = command(); applyRemoteCommand(doc, true, false); expect("RETAINED_COMMAND"); assert(waitingCommandCount == 0);
  reset(); doc = command(); doc["issuedAt"] = "invalid";
  applyRemoteCommand(doc, false, false); expect("EXPIRED_OR_INVALID_TIME"); assert(waitingCommandCount == 0);
  reset(); doc = command(); doc["expiresAt"] = iso(1794580681);
  applyRemoteCommand(doc, false, false); expect("EXPIRED_OR_INVALID_TIME");
  for (int mode : {0, 1}) {
    reset(); clockService.testMode = mode; doc = command();
    applyRemoteCommand(doc, false, false); expect("CLOCK_INVALID"); assert(waitingCommandCount == 0);
  }
  reset(); doc = command(); applyRemoteCommand(doc, false, false);
  clockService.testMode = 1; updateWaitingCommands(tick); expect("CLOCK_INVALID"); assert(saveCount == 0);
  reset(); doc = command(); applyRemoteCommand(doc, false, false);
  strcpy(assistance.requestId, "request-2"); sync(1794580630); expect("REQUEST_MISMATCH"); assert(saveCount == 0);
  reset(); doc = command(); applyRemoteCommand(doc, false, false);
  assistance.state = AssistanceState::ACKNOWLEDGED;
  sync(1794580630); expect("INVALID_TRANSITION"); assert(saveCount == 0);
  reset(); doc = command(); applyRemoteCommand(doc, false, false);
  failSave = true; sync(1794580630); expect("PERSISTENCE_ERROR");
  assert(assistance.state == AssistanceState::PENDING && commandJournal == "[]" && events.empty());

  // Fila limitada, repetição idempotente e conflito não sobrescrevem intenção.
  reset(); doc = command(); applyRemoteCommand(doc, false, false);
  auto conflict = command(); conflict["expiresAt"] = iso(1794580681);
  applyRemoteCommand(conflict, false, false); expect("ID_CONFLICT"); assert(waitingCommandCount == 1);
  for (int i = 2; i <= 9; ++i) {
    auto next = command(("ack-" + std::to_string(i)).c_str()); applyRemoteCommand(next, false, false);
  }
  expect("COMMAND_QUEUE_FULL"); assert(waitingCommandCount == 8 && saveCount == 0);
  sync(1794580630); expect("OK", "APPLIED");
  while (waitingCommandCount) updateWaitingCommands(tick);
  expect("INVALID_TRANSITION"); assert(saveCount == 1);

  // millis e contador de sincronização atravessam rollover sem liberar cedo.
  reset(); tick = UINT32_MAX - 10000; ntpSyncGeneration = UINT32_MAX;
  doc = command(); applyRemoteCommand(doc, false, false);
  tick += 29999; updateWaitingCommands(tick); assert(acks.empty());
  sync(1794580630); expect("OK", "APPLIED");
  reset(); tick = UINT32_MAX - 10000; doc = command(); applyRemoteCommand(doc, false, false);
  tick += 30000; updateWaitingCommands(tick); expect("CLOCK_SYNC_TIMEOUT");
  std::printf("PASS firmware clock (%s): cold boot, reboot/NVS, ACK/CLOSE, fresh NTP, replay, expiry, timeout, network, test clock, queue, persistence and rollover\n", NIGHTCARE_DEMO ? "demo" : "TLS");
}
