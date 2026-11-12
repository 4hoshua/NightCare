#include <Arduino.h>
#include <WiFi.h>
#include <Preferences.h>
#include <time.h>
#include <stdlib.h>
#include <string.h>
#include <esp_random.h>
#include <limits.h>
#include <atomic>
#include <ArduinoJson.h>
#include <mqtt_client.h>
#include <esp_idf_version.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
// No navegador, a aba mqtt_demo.h seleciona automaticamente a demonstracao.
// PlatformIO pode escolher explicitamente NIGHTCARE_DEMO=0 (TLS) ou =1 (demo).
#ifndef NIGHTCARE_DEMO
#if __has_include("mqtt_demo.h")
#define NIGHTCARE_DEMO 1
#else
#define NIGHTCARE_DEMO 0
#endif
#endif

#if NIGHTCARE_DEMO
#if __has_include("mqtt_demo.h")
#include "mqtt_demo.h"
#elif __has_include("mqtt_demo.example.h")
#include "mqtt_demo.example.h"
#else
#error "Demo: crie a aba mqtt_demo.h copiando Wokwi/demo/mqtt_demo.h gerado por scripts/demo.sh."
#endif
#elif __has_include("mqtt_secrets.h")
#include "mqtt_secrets.h"
#elif __has_include("mqtt_secrets.example.h")
#include "mqtt_secrets.example.h"
#else
#error "Crie a aba mqtt_demo.h para a demo gratuita, ou forneca mqtt_secrets.h para TLS."
#endif

#ifndef NIGHTCARE_DEVICE_ID
#define NIGHTCARE_DEVICE_ID "nightcare-001"
#endif
static_assert(sizeof(NIGHTCARE_DEVICE_ID) > 1 && sizeof(NIGHTCARE_DEVICE_ID) <= 33, "deviceId deve ter 1..32 caracteres");

void recordEvent(const char* type, const char* request = nullptr);
void beginConnectivity();
void updateConnectivity(unsigned long now);
uint32_t appliedConfigVersion = 0;
String commandJournal = "[]";
String bootId;
uint32_t eventCounter = 0;
bool networkPausedForTest = false;

// ---------- Hardware ----------

constexpr uint8_t PIR_PIN = 27;
constexpr uint8_t HELP_BUTTON_PIN = 14;
constexpr uint8_t GUIDE_LED_PIN = 25;
constexpr uint8_t STATUS_LED_PIN = 26;
constexpr uint8_t BUZZER_PIN = 32;

constexpr unsigned long DEBOUNCE_MS = 50;

// ---------- Configuracao ----------

enum class LightingMode {
  AUTO,
  ON,
  OFF
};

struct Configuration {
  LightingMode mode = LightingMode::AUTO;
  uint8_t brightness = 30;
  uint16_t offDelaySec = 30;
  uint16_t startMinute = 22 * 60;
  uint16_t endMinute = 6 * 60;
  int utcOffset = -3;
};

Configuration config;
Preferences preferences;

bool storageReady = false;
String savedConfig;

// ---------- Entradas ----------

struct InputManager {
  bool motion = false;
  bool buttonPressed = false;

  int lastRawButton = HIGH;
  int stableButton = HIGH;
  unsigned long lastButtonChangeMs = 0;

  void begin() {
    pinMode(PIR_PIN, INPUT);
    pinMode(HELP_BUTTON_PIN, INPUT_PULLUP);
  }

  void update(unsigned long now) {
    buttonPressed = false;

    const bool currentMotion = digitalRead(PIR_PIN) == HIGH;

    if (currentMotion != motion) {
      motion = currentMotion;
      Serial.println(motion ? "[PIR] ATIVO" : "[PIR] INATIVO");
    }

    const int rawButton = digitalRead(HELP_BUTTON_PIN);

    if (rawButton != lastRawButton) {
      lastRawButton = rawButton;
      lastButtonChangeMs = now;
    }

    if (now - lastButtonChangeMs >= DEBOUNCE_MS &&
        rawButton != stableButton) {
      stableButton = rawButton;
      buttonPressed = stableButton == LOW;
    }
  }
};

InputManager inputs;

// ---------- Relogio e Wi-Fi ----------

struct TimeService {
  // -1: horario real; 0: invalido; 1: horario fixo de teste.
  int testMode = -1;
  int testMinute = 0;

  bool valid = false;
  int minuteOfDay = 0;

  bool previousConnected = false;
  bool previousValid = false;
  unsigned long lastWifiAttemptMs = 0;

  void configureTimezone() {
    char timezone[16];

    // POSIX utiliza sinal invertido:
    // UTC+3 representa horario local UTC-3.
    snprintf(
      timezone,
      sizeof(timezone),
      "UTC%+d",
      -config.utcOffset
    );

    configTzTime(timezone, "pool.ntp.org");
  }

  void begin() {
    configureTimezone();

    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin("Wokwi-GUEST", "", 6);

    lastWifiAttemptMs = millis();

    Serial.println(
      "[WIFI] Conectando sem bloquear o programa..."
    );
  }

  void update(unsigned long now) {
    const bool connected = WiFi.status() == WL_CONNECTED;

    if (connected != previousConnected) {
      previousConnected = connected;

      Serial.println(
        connected ? "[WIFI] Conectado." : "[WIFI] Desconectado."
      );
    }

    if (!connected && !networkPausedForTest && now - lastWifiAttemptMs >= 30000UL) {
      lastWifiAttemptMs = now;
      WiFi.reconnect();
    }

    if (testMode == 1) {
      valid = true;
      minuteOfDay = testMinute;
    } else if (testMode == 0) {
      valid = false;
    } else {
      const time_t timestamp = time(nullptr);

      // Data minima plausivel: 01/01/2024.
      valid = timestamp >= 1704067200;

      if (valid) {
        struct tm localTime;
        localtime_r(&timestamp, &localTime);

        minuteOfDay = localTime.tm_hour * 60 + localTime.tm_min;
      }
    }

    if (valid != previousValid) {
      previousValid = valid;

      Serial.println(
        valid
          ? "[RELOGIO] Horario valido."
          : "[RELOGIO] Invalido: movimento permitido sem agenda."
      );
    }
  }

  bool scheduleAllowsMotion() const {
    if (!valid) {
      return true;
    }

    const int start = config.startMinute;
    const int end = config.endMinute;

    if (start == end) {
      return true;
    }

    if (start < end) {
      return minuteOfDay >= start && minuteOfDay < end;
    }

    return minuteOfDay >= start || minuteOfDay < end;
  }
};

TimeService clockService;

// ---------- Iluminacao ----------

struct LightingController {
  bool automaticLightOn = false;
  bool waitingToTurnOff = false;
  unsigned long inactiveSinceMs = 0;

  int appliedPwm = 0;

  void begin() {
    pinMode(GUIDE_LED_PIN, OUTPUT);
    analogWrite(GUIDE_LED_PIN, 0);
  }

  void update(
    unsigned long now,
    bool motion,
    bool scheduleAllowed
  ) {
    if (!scheduleAllowed) {
      automaticLightOn = false;
      waitingToTurnOff = false;
    } else if (motion) {
      automaticLightOn = true;
      waitingToTurnOff = false;
    } else if (automaticLightOn) {
      if (!waitingToTurnOff) {
        waitingToTurnOff = true;
        inactiveSinceMs = now;

        Serial.println(
          "[LUZ] Contagem para desligar iniciada."
        );
      }

      const unsigned long delayMs =
        static_cast<unsigned long>(config.offDelaySec) * 1000UL;

      if (now - inactiveSinceMs >= delayMs) {
        automaticLightOn = false;
        waitingToTurnOff = false;
      }
    }

    bool shouldBeOn = automaticLightOn;

    if (config.mode == LightingMode::ON) {
      shouldBeOn = true;
    } else if (config.mode == LightingMode::OFF) {
      shouldBeOn = false;
    }

    const int targetPwm = shouldBeOn
      ? (config.brightness * 255UL + 50) / 100
      : 0;

    if (targetPwm != appliedPwm) {
      appliedPwm = targetPwm;
      analogWrite(GUIDE_LED_PIN, targetPwm);

      Serial.printf(
        "[LUZ] %s | PWM=%d\n",
        shouldBeOn ? "LIGADA" : "DESLIGADA",
        targetPwm
      );
    }
  }
};

LightingController lighting;

// ---------- Persistencia das configuracoes ----------

String serializeConfiguration() {
  char text[80];

  snprintf(
    text,
    sizeof(text),
    "2,%u,%u,%u,%u,%u,%d,%lu",
    static_cast<unsigned>(config.mode),
    static_cast<unsigned>(config.brightness),
    static_cast<unsigned>(config.offDelaySec),
    static_cast<unsigned>(config.startMinute),
    static_cast<unsigned>(config.endMinute),
    config.utcOffset,
    static_cast<unsigned long>(appliedConfigVersion)
  );

  return String(text);
}

void loadConfiguration() {
  storageReady = preferences.begin("nightcare", false);

  if (!storageReady) {
    Serial.println(
      "[NVS] Falha ao abrir memoria. Usando padroes."
    );
    return;
  }

  const String stored = preferences.getString("config", "");

  if (stored.isEmpty()) {
    Serial.println(
      "[NVS] Sem configuracao salva. Usando padroes."
    );
    return;
  }

  unsigned version = 0;
  unsigned mode = 0;
  unsigned brightness = 0;
  unsigned delaySec = 0;
  unsigned start = 0;
  unsigned end = 0;
  int offset = 0;
  int consumed = 0;

  unsigned long remoteVersion = 0;
  const int fields = sscanf(
    stored.c_str(),
    "%u,%u,%u,%u,%u,%u,%d,%lu%n",
    &version,
    &mode,
    &brightness,
    &delaySec,
    &start,
    &end,
    &offset,
    &remoteVersion,
    &consumed
  );

  int parsedFields = fields;
  if (version == 1) {
    parsedFields = sscanf(stored.c_str(), "%u,%u,%u,%u,%u,%u,%d%n", &version, &mode, &brightness, &delaySec, &start, &end, &offset, &consumed);
  }
  const bool valid =
    parsedFields == (version == 1 ? 7 : 8) &&
    consumed == static_cast<int>(stored.length()) &&
    (version == 1 || version == 2) &&
    remoteVersion <= 2147483647UL &&
    mode <= 2 &&
    brightness >= 1 && brightness <= 100 &&
    delaySec >= 1 && delaySec <= 600 &&
    start < 1440 && end < 1440 &&
    offset >= -12 && offset <= 14;

  if (!valid) {
    Serial.println(
      "[NVS] Configuracao invalida. Usando padroes."
    );
    return;
  }

  config.mode = static_cast<LightingMode>(mode);
  config.brightness = brightness;
  config.offDelaySec = delaySec;
  config.startMinute = start;
  config.endMinute = end;
  config.utcOffset = offset;
  appliedConfigVersion = remoteVersion;

  savedConfig = stored;

  Serial.println("[NVS] Configuracao recuperada.");
}

void saveConfiguration() {
  const String serialized = serializeConfiguration();

  if (serialized == savedConfig) {
    Serial.println("[NVS] Sem alteracoes para gravar.");
    return;
  }

  if (!storageReady ||
      preferences.putString("config", serialized) == 0) {
    Serial.println(
      "[NVS] Falha ao salvar. Alteracao aplicada somente em RAM."
    );
    return;
  }

  savedConfig = serialized;

  Serial.println("[NVS] Configuracao salva.");
}

// ---------- Solicitacao de assistencia ----------

enum class AssistanceState {
  NONE,
  PENDING,
  ACKNOWLEDGED
};

struct AssistanceController {
  AssistanceState state = AssistanceState::NONE;

  char requestId[65] = "";
  unsigned long pressCount = 0;

  unsigned long signalStartedMs = 0;
  bool buzzerOn = false;
  bool persisted = false;

  const char* stateName() const {
    switch (state) {
      case AssistanceState::NONE:
        return "SEM_SOLICITACAO";

      case AssistanceState::PENDING:
        return "PENDENTE";

      case AssistanceState::ACKNOWLEDGED:
        return "RECONHECIDA";
    }

    return "?";
  }

  void generateRequestId() {
    const String id = (String(NIGHTCARE_DEVICE_ID) + "-") + bootId + "-" + String(++eventCounter);
    snprintf(requestId, sizeof(requestId), "%s", id.c_str());
  }

  void stopBuzzer() {
    if (buzzerOn) {
      noTone(BUZZER_PIN);
      buzzerOn = false;
    }
  }

  void save() {
    if (!storageReady) {
      persisted = false;

      Serial.println(
        "[ASSISTENCIA] Falha: memoria indisponivel. "
        "Estado mantido somente em RAM."
      );
      return;
    }

    char record[100];

    snprintf(
      record,
      sizeof(record),
      "1,%u,%lu,%s",
      static_cast<unsigned>(state),
      pressCount,
      state == AssistanceState::NONE ? "-" : requestId
    );

    persisted = preferences.putString("help", String(record) + "\n" + commandJournal) > 0;

    if (!persisted) {
      Serial.println(
        "[ASSISTENCIA] Falha ao salvar. "
        "Recuperacao apos reinicio nao garantida."
      );
    }
  }

  void begin() {
    stopBuzzer();
    digitalWrite(STATUS_LED_PIN, LOW);

    if (!storageReady) {
      Serial.println(
        "[ASSISTENCIA] Sem memoria para recuperar chamado."
      );
      return;
    }

    String record = preferences.getString("help", "");
    const int separator = record.indexOf('\n');
    if (separator >= 0) {
      commandJournal = record.substring(separator + 1);
      JsonDocument journal;
      if (deserializeJson(journal, commandJournal) || !journal.is<JsonArray>() || journal.size() > 16) commandJournal = "[]";
      record = record.substring(0, separator);
    }

    if (record.isEmpty()) {
      Serial.println("[ASSISTENCIA] Nenhum chamado salvo.");
      return;
    }

    unsigned version = 0;
    unsigned storedState = 0;
    unsigned long storedCount = 0;
    char storedId[65] = "";
    int consumed = 0;

    const int fields = sscanf(
      record.c_str(),
      "%u,%u,%lu,%64s%n",
      &version,
      &storedState,
      &storedCount,
      storedId,
      &consumed
    );

    bool validId =
      strlen(storedId) > strlen(NIGHTCARE_DEVICE_ID) + 17 && strlen(storedId) < 65 &&
      strncmp(storedId, (String(NIGHTCARE_DEVICE_ID) + "-").c_str(), strlen(NIGHTCARE_DEVICE_ID) + 1) == 0;

    if (validId) {
      for (size_t i = strlen(NIGHTCARE_DEVICE_ID) + 1; i < strlen(storedId); i++) {
        const char c = storedId[i];

        if (!((c >= '0' && c <= '9') ||
              (c >= 'a' && c <= 'f') || c == '-')) {
          validId = false;
          break;
        }
      }
    }

    const bool valid =
      fields == 4 &&
      consumed == static_cast<int>(record.length()) &&
      version == 1 &&
      storedState <= 2 &&
      (
        (storedState == 0 &&
         storedCount == 0 &&
         strcmp(storedId, "-") == 0) ||
        (storedState != 0 &&
         storedCount > 0 &&
         validId)
      );

    if (!valid) {
      state = AssistanceState::PENDING;
      pressCount = 1;

      generateRequestId();
      signalStartedMs = millis();

      Serial.println(
        "[ASSISTENCIA] Registro invalido. "
        "Aberto chamado de recuperacao para verificacao."
      );

      save();
      return;
    }

    state = static_cast<AssistanceState>(storedState);
    pressCount = storedCount;

    if (state != AssistanceState::NONE) {
      snprintf(requestId, sizeof(requestId), "%s", storedId);
    }

    persisted = true;
    signalStartedMs = millis();

    Serial.printf(
      "[ASSISTENCIA] Recuperado: %s | requestId=%s\n",
      stateName(),
      state == AssistanceState::NONE ? "-" : requestId
    );
  }

  void onButtonPressed(unsigned long now) {
    if (state == AssistanceState::NONE) {
      state = AssistanceState::PENDING;
      pressCount = 1;

      generateRequestId();
      signalStartedMs = now;

      Serial.printf(
        "[ASSISTENCIA] NOVO PEDIDO | requestId=%s\n",
        requestId
      );
    } else {
      // Reitera o mesmo pedido sem alterar seu estado.
      if (pressCount < ULONG_MAX) {
        pressCount++;
      }

      Serial.printf(
        "[ASSISTENCIA] REITERACAO | requestId=%s | cliques=%lu\n",
        requestId,
        pressCount
      );
    }

    save();
    recordEvent(pressCount == 1 ? "HELP_OPENED" : "HELP_REITERATED", requestId);
  }

  void acknowledge() {
    if (state == AssistanceState::NONE) {
      Serial.println("[ERRO] Nao existe pedido ativo.");
      return;
    }

    if (state == AssistanceState::ACKNOWLEDGED) {
      Serial.println("[ASSISTENCIA] Pedido ja reconhecido.");
      return;
    }

    state = AssistanceState::ACKNOWLEDGED;

    stopBuzzer();
    digitalWrite(STATUS_LED_PIN, HIGH);

    Serial.printf(
      "[ASSISTENCIA] RECONHECIDO | requestId=%s\n",
      requestId
    );

    save();
    recordEvent("HELP_ACKNOWLEDGED", requestId);
  }

  void close() {
    if (state == AssistanceState::NONE) {
      Serial.println(
        "[ASSISTENCIA] Nenhum pedido para encerrar."
      );
      return;
    }

    if (state != AssistanceState::ACKNOWLEDGED) {
      Serial.println(
        "[ERRO] Reconheca o pedido antes de encerrar."
      );
      return;
    }

    Serial.printf(
      "[ASSISTENCIA] ENCERRADO | requestId=%s | cliques=%lu\n",
      requestId,
      pressCount
    );

    recordEvent("HELP_CLOSED", requestId);
    state = AssistanceState::NONE;
    requestId[0] = '\0';
    pressCount = 0;

    stopBuzzer();
    digitalWrite(STATUS_LED_PIN, LOW);

    save();
  }

  void printStatus() const {
    Serial.printf(
      "[ASSISTENCIA] estado=%s | requestId=%s"
      " | cliques=%lu | salvoEmNVS=%s\n",
      stateName(),
      state == AssistanceState::NONE ? "-" : requestId,
      pressCount,
      persisted ? "SIM" : "NAO"
    );
  }

  void update(unsigned long now, bool buttonPressed) {
    if (buttonPressed) {
      onButtonPressed(now);
    }

    if (state == AssistanceState::PENDING) {
      const unsigned long elapsed = now - signalStartedMs;

      const bool ledOn = (elapsed / 500UL) % 2 == 0;
      const bool shouldBeep = elapsed % 5000UL < 100UL;

      digitalWrite(STATUS_LED_PIN, ledOn ? HIGH : LOW);

      if (shouldBeep && !buzzerOn) {
        tone(BUZZER_PIN, 2000);
        buzzerOn = true;
      } else if (!shouldBeep) {
        stopBuzzer();
      }
    } else {
      stopBuzzer();

      digitalWrite(
        STATUS_LED_PIN,
        state == AssistanceState::ACKNOWLEDGED ? HIGH : LOW
      );
    }
  }
};

AssistanceController assistance;

// ---------- Status e comandos ----------

const char* modeName() {
  switch (config.mode) {
    case LightingMode::AUTO:
      return "AUTO";

    case LightingMode::ON:
      return "ON";

    case LightingMode::OFF:
      return "OFF";
  }

  return "?";
}

void refreshLighting() {
  const unsigned long now = millis();

  clockService.update(now);

  lighting.update(
    now,
    inputs.motion,
    clockService.scheduleAllowsMotion()
  );
}

void printStatus() {
  Serial.printf("[DISPOSITIVO] id=%s\n", NIGHTCARE_DEVICE_ID);
  Serial.printf(
    "[CONFIG] modo=%s | brilho=%u%% | tempo=%u s\n",
    modeName(),
    static_cast<unsigned>(config.brightness),
    static_cast<unsigned>(config.offDelaySec)
  );

  Serial.printf(
    "[AGENDA] %02u:%02u ate %02u:%02u | fuso=UTC%+d\n",
    static_cast<unsigned>(config.startMinute / 60),
    static_cast<unsigned>(config.startMinute % 60),
    static_cast<unsigned>(config.endMinute / 60),
    static_cast<unsigned>(config.endMinute % 60),
    config.utcOffset
  );

  if (clockService.valid) {
    Serial.printf(
      "[RELOGIO] %02d:%02d | fonte=%s\n",
      clockService.minuteOfDay / 60,
      clockService.minuteOfDay % 60,
      clockService.testMode == 1 ? "TESTE FIXO" : "REAL/NTP"
    );
  } else {
    Serial.println(
      "[RELOGIO] INVALIDO | clockValid=false"
    );
  }

  Serial.printf(
    "[ESTADO] WiFi=%s | movimentoPermitido=%s"
    " | PIR=%s | PWM=%d\n",
    WiFi.status() == WL_CONNECTED ? "ONLINE" : "OFFLINE",
    clockService.scheduleAllowsMotion() ? "SIM" : "NAO",
    inputs.motion ? "ATIVO" : "INATIVO",
    lighting.appliedPwm
  );

  assistance.printStatus();
}

void printHelp() {
  Serial.println();
  Serial.println("auto / on / off");
  Serial.println("brilho N            -> 1 a 100");
  Serial.println("tempo N             -> 1 a 600 segundos");
  Serial.println("agenda HH:MM HH:MM  -> inicio e fim");
  Serial.println("fuso N              -> UTC inteiro, -12 a 14");
  Serial.println("hora HH:MM          -> horario FIXO de teste");
  Serial.println("hora real           -> retornar ao relogio real");
  Serial.println("hora invalida       -> testar falha do relogio");
  Serial.println("reconhecer          -> confirmar recebimento do pedido");
  Serial.println("encerrar            -> finalizar pedido reconhecido");
  Serial.println("status / ajuda");
  Serial.println("reiniciar           -> reinicio do ESP32");
#if defined(NIGHTCARE_DEMO) && NIGHTCARE_DEMO
  Serial.println("rede off / rede on  -> interromper/restaurar WiFi para teste local");
#endif
}

bool parseNumber(
  const char* text,
  long minimum,
  long maximum,
  long& result
) {
  if (*text == '\0' || strlen(text) > 6) {
    return false;
  }

  char* end = nullptr;
  const long value = strtol(text, &end, 10);

  if (end == text || *end != '\0' ||
      value < minimum || value > maximum) {
    return false;
  }

  result = value;
  return true;
}

bool parseHHMM(const char* text, uint16_t& result) {
  if (strlen(text) != 5 || text[2] != ':') {
    return false;
  }

  for (int i = 0; i < 5; i++) {
    if (i == 2) {
      continue;
    }

    if (text[i] < '0' || text[i] > '9') {
      return false;
    }
  }

  const int hour =
    (text[0] - '0') * 10 + (text[1] - '0');

  const int minute =
    (text[3] - '0') * 10 + (text[4] - '0');

  if (hour > 23 || minute > 59) {
    return false;
  }

  result = hour * 60 + minute;
  return true;
}

void handleCommand(const char* command) {
#if defined(NIGHTCARE_DEMO) && NIGHTCARE_DEMO
  if (strcmp(command, "rede off") == 0) {
    networkPausedForTest = true;
    WiFi.setAutoReconnect(false);
    WiFi.disconnect(false, false);
    Serial.println("[TESTE] WiFi pausado. Controle local continua; use rede on para reconectar.");
    return;
  }
  if (strcmp(command, "rede on") == 0) {
    networkPausedForTest = false;
    WiFi.setAutoReconnect(true);
    WiFi.begin("Wokwi-GUEST", "", 6);
    Serial.println("[TESTE] Reconectando WiFi sem reiniciar o dispositivo.");
    return;
  }
#endif
  if (strcmp(command, "reconhecer") == 0) {
    assistance.acknowledge();
    assistance.printStatus();
    return;
  }

  if (strcmp(command, "encerrar") == 0) {
    assistance.close();
    assistance.printStatus();
    return;
  }

  long value = 0;
  bool configurationChanged = false;

  if (strcmp(command, "auto") == 0 ||
      strcmp(command, "on") == 0 ||
      strcmp(command, "off") == 0) {
    config.mode = strcmp(command, "auto") == 0
      ? LightingMode::AUTO
      : (strcmp(command, "on") == 0
          ? LightingMode::ON
          : LightingMode::OFF);

    configurationChanged = true;
  } else if (strncmp(command, "brilho ", 7) == 0) {
    if (!parseNumber(command + 7, 1, 100, value)) {
      Serial.println(
        "[ERRO] Brilho deve estar entre 1 e 100."
      );
      return;
    }

    config.brightness = value;
    configurationChanged = true;
  } else if (strncmp(command, "tempo ", 6) == 0) {
    if (!parseNumber(command + 6, 1, 600, value)) {
      Serial.println(
        "[ERRO] Tempo deve estar entre 1 e 600."
      );
      return;
    }

    config.offDelaySec = value;
    configurationChanged = true;
  } else if (strncmp(command, "agenda ", 7) == 0) {
    if (strlen(command) != 18 || command[12] != ' ') {
      Serial.println("[ERRO] Use: agenda HH:MM HH:MM");
      return;
    }

    char startText[6];
    char endText[6];

    memcpy(startText, command + 7, 5);
    memcpy(endText, command + 13, 5);

    startText[5] = '\0';
    endText[5] = '\0';

    uint16_t startMinute = 0;
    uint16_t endMinute = 0;

    if (!parseHHMM(startText, startMinute) ||
        !parseHHMM(endText, endMinute)) {
      Serial.println("[ERRO] Horario invalido.");
      return;
    }

    config.startMinute = startMinute;
    config.endMinute = endMinute;
    configurationChanged = true;
  } else if (strncmp(command, "fuso ", 5) == 0) {
    if (!parseNumber(command + 5, -12, 14, value)) {
      Serial.println(
        "[ERRO] Use fuso inteiro entre -12 e 14."
      );
      return;
    }

    config.utcOffset = value;
    clockService.configureTimezone();
    configurationChanged = true;
  } else if (strcmp(command, "hora real") == 0) {
    clockService.testMode = -1;
  } else if (strcmp(command, "hora invalida") == 0) {
    clockService.testMode = 0;
  } else if (strncmp(command, "hora ", 5) == 0) {
    uint16_t minute = 0;

    if (!parseHHMM(command + 5, minute)) {
      Serial.println("[ERRO] Use: hora HH:MM");
      return;
    }

    clockService.testMinute = minute;
    clockService.testMode = 1;
  } else if (strcmp(command, "status") == 0) {
    refreshLighting();
    printStatus();
    return;
  } else if (strcmp(command, "ajuda") == 0) {
    printHelp();
    return;
  } else if (strcmp(command, "reiniciar") == 0) {
    ESP.restart();
    return;
  } else {
    Serial.println(
      "[ERRO] Comando desconhecido. Digite ajuda."
    );
    return;
  }

  if (configurationChanged) {
    saveConfiguration();
  }

  refreshLighting();
  printStatus();
}

void updateSerial() {
  static char buffer[64];
  static size_t length = 0;
  static bool overflow = false;

  uint8_t budget = 32;

  while (Serial.available() > 0 && budget > 0) {
    budget--;

    const char character = Serial.read();

    if (character == '\n' || character == '\r') {
      if (overflow) {
        Serial.println("[ERRO] Comando muito longo.");
      } else if (length > 0) {
        buffer[length] = '\0';
        handleCommand(buffer);
      }

      length = 0;
      overflow = false;
    } else if (!overflow) {
      if (length < sizeof(buffer) - 1) {
        buffer[length++] = character;
      } else {
        overflow = true;
      }
    }
  }
}

// ---------- MQTT TLS: network I/O runs in the ESP-MQTT task ----------
// MQTT callbacks never mutate local controllers or Preferences.
struct InboundMessage { char topic[160]; char payload[1537]; bool retained; };
struct PendingEvent { String payload; bool assistance; int packetId = -1; unsigned long sentAt = 0; };
PendingEvent eventQueue[100];
size_t eventCount = 0;
int eventInFlight = -1;
unsigned long eventInFlightSince = 0;
uint32_t droppedEvents = 0;
QueueHandle_t inboundQueue = nullptr;
QueueHandle_t deliveryQueue = nullptr;
esp_mqtt_client_handle_t mqttClient = nullptr;
std::atomic<bool> mqttOnline{false};
std::atomic<bool> mqttJustConnected{false};
std::atomic<bool> mqttNeedsRetry{false};
uint32_t retryDelayMs = 1000;
unsigned long retryStartedMs = 0;
uint32_t stateSequence = 0;
unsigned long lastHeartbeatMs = 0;
bool lastMotion = false;
bool lastLight = false;
String lastState;
#ifndef MQTT_TOPIC_PREFIX
#define MQTT_TOPIC_PREFIX "nightcare/" NIGHTCARE_DEVICE_ID "/"
#endif
#ifndef MQTT_CLIENT_ID
#define MQTT_CLIENT_ID NIGHTCARE_DEVICE_ID
#endif
#ifndef MQTT_USE_TLS
#define MQTT_USE_TLS 1
#endif
#ifndef MQTT_PORT
#define MQTT_PORT 8883
#endif
const char* MQTT_PREFIX = MQTT_TOPIC_PREFIX;
const String configTopic = String(MQTT_PREFIX) + "config/set";
const String commandsTopic = String(MQTT_PREFIX) + "commands";
const String availabilityTopic = String(MQTT_PREFIX) + "availability";

String utcNow() {
  if (clockService.testMode != -1 || time(nullptr) < 1704067200) return "";
  const time_t now = time(nullptr); struct tm utc; gmtime_r(&now, &utc);
  char text[25]; strftime(text, sizeof(text), "%Y-%m-%dT%H:%M:%SZ", &utc); return text;
}
void envelope(JsonDocument& doc) { doc["schemaVersion"] = 1; doc["deviceId"] = NIGHTCARE_DEVICE_ID; }
const char* assistanceName() {
  return assistance.state == AssistanceState::NONE ? "NONE" : assistance.state == AssistanceState::PENDING ? "PENDING" : "ACKNOWLEDGED";
}
void recordEvent(const char* type, const char* request) {
  JsonDocument doc; envelope(doc);
  // The opening event ID is exactly its requestId; later events have fresh IDs.
  doc["eventId"] = strcmp(type,"HELP_OPENED") == 0 ? String(request) : (String(NIGHTCARE_DEVICE_ID) + "-") + bootId + "-" + String(++eventCounter);
  doc["bootId"] = bootId; doc["type"] = type; doc["uptimeMs"] = millis();
  const String timestamp = utcNow();
  if (timestamp.isEmpty()) doc["occurredAt"] = nullptr; else doc["occurredAt"] = timestamp;
  if (request && *request) doc["requestId"] = request; else doc["requestId"] = nullptr;
  doc["pressCount"] = assistance.pressCount;
  if (eventCount == 100) {
    size_t victim = 0;
    for (size_t i = 0; i < eventCount; ++i) if (!eventQueue[i].assistance) { victim = i; break; }
    for (size_t i = victim; i + 1 < eventCount; ++i) eventQueue[i] = eventQueue[i + 1];
    --eventCount; ++droppedEvents;
  }
  auto& item = eventQueue[eventCount++];
  item.payload = ""; serializeJson(doc,item.payload); item.assistance = strncmp(type,"HELP_",5) == 0; item.packetId = -1;
}
int enqueueMqtt(const char* suffix, const String& payload, bool retained) {
  if (!mqttClient || !mqttOnline) return -1;
  const String topic = String(MQTT_PREFIX) + suffix;
  return esp_mqtt_client_enqueue(mqttClient,topic.c_str(),payload.c_str(),payload.length(),1,retained,true);
}
void sendAck(JsonDocument& doc, const char* status, const char* reason) {
  envelope(doc); doc["status"] = status; doc["reason"] = reason;
  String payload; serializeJson(doc,payload); enqueueMqtt("acks",payload,false);
}
void mqttCallback(void*, esp_event_base_t, int32_t eventId, void* data) {
  auto* event = static_cast<esp_mqtt_event_handle_t>(data);
  if (eventId == MQTT_EVENT_CONNECTED) {
    mqttOnline = true; mqttJustConnected = true; mqttNeedsRetry = false;
    esp_mqtt_client_subscribe(event->client,configTopic.c_str(),1);
    esp_mqtt_client_subscribe(event->client,commandsTopic.c_str(),1);
  } else if (eventId == MQTT_EVENT_DISCONNECTED) {
    mqttOnline = false; mqttNeedsRetry = true;
  } else if (eventId == MQTT_EVENT_PUBLISHED) {
    const int id = event->msg_id;
    xQueueSend(deliveryQueue,&id,0);
  } else if (eventId == MQTT_EVENT_DATA) {
    static InboundMessage message;
    static size_t received = 0;
    if (event->current_data_offset == 0) {
      received = 0; memset(&message,0,sizeof(message));
      if (event->topic_len <= 0 || event->topic_len >= sizeof(message.topic) || event->total_data_len > 1536) return;
      memcpy(message.topic,event->topic,event->topic_len); message.retained = event->retain;
    }
    if (message.topic[0] == '\0' || event->total_data_len > 1536 || event->current_data_offset != received) return;
    memcpy(message.payload + received,event->data,event->data_len); received += event->data_len;
    if (received == event->total_data_len) {
      message.payload[received] = '\0';
      if (xQueueSend(inboundQueue,&message,0) != pdTRUE) Serial.println("[MQTT] Fila de entrada cheia: mensagem sem confirmação.");
      message.topic[0] = '\0';
    }
  }
}
void beginConnectivity() {
  inboundQueue = xQueueCreate(8,sizeof(InboundMessage));
  deliveryQueue = xQueueCreate(32,sizeof(int));
  if (!inboundQueue || !deliveryQueue) { Serial.println("[MQTT] Sem memoria; controle local continua."); return; }
  if (strstr(MQTT_HOST,".example") || strstr(MQTT_PASSWORD,"SUBSTITUA")) { Serial.println("[MQTT] Preencha mqtt_secrets.h para habilitar a rede."); return; }
  static String uri = String(MQTT_USE_TLS ? "mqtts://" : "mqtt://") + MQTT_HOST + ":" + String(MQTT_PORT);
  static const char will[] = "{\"schemaVersion\":1,\"deviceId\":\"" NIGHTCARE_DEVICE_ID "\",\"status\":\"offline\"}";
  esp_mqtt_client_config_t cfg = {};
#if ESP_IDF_VERSION_MAJOR >= 5
  cfg.broker.address.uri = uri.c_str(); cfg.broker.verification.certificate = MQTT_USE_TLS ? MQTT_CA : nullptr;
  cfg.credentials.username = strlen(MQTT_USER) ? MQTT_USER : nullptr; cfg.credentials.authentication.password = strlen(MQTT_PASSWORD) ? MQTT_PASSWORD : nullptr;
  cfg.credentials.client_id = MQTT_CLIENT_ID;
  cfg.session.last_will.topic = availabilityTopic.c_str();
  cfg.session.last_will.msg = will; cfg.session.last_will.qos = 1; cfg.session.last_will.retain = true;
  cfg.session.keepalive = 15; cfg.network.disable_auto_reconnect = true; cfg.network.timeout_ms = 5000;
  cfg.buffer.size = 2048;
#else
  cfg.uri = uri.c_str(); cfg.cert_pem = MQTT_USE_TLS ? MQTT_CA : nullptr;
  cfg.username = strlen(MQTT_USER) ? MQTT_USER : nullptr; cfg.password = strlen(MQTT_PASSWORD) ? MQTT_PASSWORD : nullptr; cfg.client_id = MQTT_CLIENT_ID;
  cfg.lwt_topic = availabilityTopic.c_str(); cfg.lwt_msg = will; cfg.lwt_qos = 1; cfg.lwt_retain = true;
  cfg.keepalive = 15; cfg.disable_auto_reconnect = true; cfg.network_timeout_ms = 5000; cfg.buffer_size = 2048;
#endif
  mqttClient = esp_mqtt_client_init(&cfg);
  if (!mqttClient) { Serial.println("[MQTT] Inicializacao falhou; controle local continua."); return; }
  esp_mqtt_client_register_event(mqttClient,static_cast<esp_mqtt_event_id_t>(ESP_EVENT_ANY_ID),mqttCallback,nullptr);
  // Start after NTP: certificate validity must be checked against a real UTC clock.
}
bool mqttStarted = false;
bool validInteger(JsonVariantConst v, long minimum, long maximum) { return v.is<long>() && v.as<long>() >= minimum && v.as<long>() <= maximum; }
void applyRemoteConfig(JsonDocument& doc) {
  JsonDocument ack;
  if (!validInteger(doc["configVersion"],1,2147483647)) return;
  const uint32_t version = doc["configVersion"].as<uint32_t>(); ack["configVersion"] = version;
  Configuration candidate = config; uint16_t start = 0, end = 0;
  const String mode = doc["mode"] | "";
  const bool valid = doc.size() == 9 && doc["schemaVersion"].is<int>() && doc["schemaVersion"].as<int>() == 1 &&
    String(doc["deviceId"] | "") == NIGHTCARE_DEVICE_ID &&
    (mode == "AUTO" || mode == "ON" || mode == "OFF") &&
    validInteger(doc["brightnessPct"],1,100) && validInteger(doc["offDelaySec"],1,600) &&
    parseHHMM(doc["startTime"] | "",start) && parseHHMM(doc["endTime"] | "",end) &&
    String(doc["timezone"] | "") == "America/Sao_Paulo";
  if (!valid) { sendAck(ack,"REJECTED","INVALID_CONFIG"); return; }
  candidate.mode = mode == "AUTO" ? LightingMode::AUTO : mode == "ON" ? LightingMode::ON : LightingMode::OFF;
  candidate.brightness = doc["brightnessPct"]; candidate.offDelaySec = doc["offDelaySec"];
  candidate.startMinute = start; candidate.endMinute = end; candidate.utcOffset = -3;
  if (version < appliedConfigVersion) { sendAck(ack,"REJECTED","STALE_VERSION"); return; }
  if (version == appliedConfigVersion) {
    const bool same = config.mode == candidate.mode && config.brightness == candidate.brightness && config.offDelaySec == candidate.offDelaySec && config.startMinute == start && config.endMinute == end && config.utcOffset == -3;
    sendAck(ack,same ? "APPLIED" : "REJECTED",same ? "ALREADY_APPLIED" : "VERSION_CONFLICT"); return;
  }
  const auto previous = config; const auto previousVersion = appliedConfigVersion;
  config = candidate; appliedConfigVersion = version;
  const String serialized = serializeConfiguration();
  if (!storageReady || preferences.putString("config",serialized) == 0) {
    config = previous; appliedConfigVersion = previousVersion; sendAck(ack,"REJECTED","PERSISTENCE_ERROR"); return;
  }
  savedConfig = serialized; clockService.configureTimezone(); refreshLighting();
  recordEvent("CONFIG_APPLIED"); sendAck(ack,"APPLIED","OK");
}
bool parseUtc(const char* value, time_t& result) {
  // Accept API's millisecond precision and the canonical second precision only.
  const size_t n = strlen(value);
  if (n != 20 && n != 24) return false;
  if (value[n-1] != 'Z' || (n == 24 && (value[19] != '.' || !isdigit(value[20]) || !isdigit(value[21]) || !isdigit(value[22])))) return false;
  struct tm t = {}; char* end = strptime(value,"%Y-%m-%dT%H:%M:%S",&t);
  if (!end || end != value+19) return false;
  // mktime uses the local timezone; timegm is not portable in Arduino newlib.
  const int offset = config.utcOffset * 3600;
  t.tm_isdst = 0; result = mktime(&t) + offset;
  struct tm normalized; gmtime_r(&result,&normalized); char text[20]; strftime(text,sizeof(text),"%Y-%m-%dT%H:%M:%S",&normalized);
  return strncmp(text,value,19) == 0;
}
bool validId(const String& value) {
  if (value.isEmpty() || value.length() > 64) return false;
  for(size_t i=0;i<value.length();++i) if(!isalnum(value[i]) && value[i]!='-' && value[i]!='_') return false;
  return true;
}
void applyRemoteCommand(JsonDocument& doc, bool retained) {
  const String id = doc["commandId"] | ""; const String request = doc["requestId"] | ""; const String action = doc["action"] | "";
  if (!validId(id) || !validId(request)) return;
  JsonDocument ack; ack["commandId"] = id; ack["requestId"] = request;
  const String fingerprint = request + "|" + action + "|" + String(doc["issuedAt"] | "") + "|" + String(doc["expiresAt"] | "");
  if (retained) { sendAck(ack,"REJECTED","RETAINED_COMMAND"); return; }
  if (doc.size() != 7 || !doc["schemaVersion"].is<int>() || doc["schemaVersion"].as<int>() != 1 || String(doc["deviceId"] | "") != NIGHTCARE_DEVICE_ID) { sendAck(ack,"REJECTED","INVALID_COMMAND"); return; }
  JsonDocument journal; deserializeJson(journal,commandJournal);
  for (JsonObject entry : journal.as<JsonArray>()) if (String(entry["id"] | "") == id) {
    const bool same = String(entry["fingerprint"] | "") == fingerprint;
    sendAck(ack,same ? "APPLIED" : "REJECTED",same ? "ALREADY_APPLIED" : "ID_CONFLICT"); return;
  }
  time_t issued = 0, expires = 0; const time_t now = time(nullptr);
  if (clockService.testMode != -1 || !clockService.valid || now < 1704067200) { sendAck(ack,"REJECTED","CLOCK_INVALID"); return; }
  if (!parseUtc(doc["issuedAt"] | "",issued) || !parseUtc(doc["expiresAt"] | "",expires) || expires-issued != 60 || issued > now+5 || now >= expires) { sendAck(ack,"REJECTED","EXPIRED_OR_INVALID_TIME"); return; }
  if (request != assistance.requestId || assistance.state == AssistanceState::NONE) { sendAck(ack,"REJECTED","REQUEST_MISMATCH"); return; }
  if (!((action == "ACK_HELP" && assistance.state == AssistanceState::PENDING) || (action == "CLOSE_HELP" && assistance.state == AssistanceState::ACKNOWLEDGED))) { sendAck(ack,"REJECTED","INVALID_TRANSITION"); return; }
  // Atomically store resulting assistance state and idempotency journal in the SAME NVS value.
  const auto previousState = assistance.state; const auto previousCount = assistance.pressCount;
  const String previousId = assistance.requestId; const String previousJournal = commandJournal;
  if (journal.size() >= 16) journal.as<JsonArray>().remove(0);
  JsonObject entry = journal.as<JsonArray>().add<JsonObject>(); entry["id"] = id; entry["fingerprint"] = fingerprint;
  commandJournal = ""; serializeJson(journal,commandJournal);
  assistance.state = action == "ACK_HELP" ? AssistanceState::ACKNOWLEDGED : AssistanceState::NONE;
  if (action == "CLOSE_HELP") { assistance.requestId[0] = '\0'; assistance.pressCount = 0; }
  assistance.save();
  if (!assistance.persisted) {
    assistance.state = previousState; assistance.pressCount = previousCount; snprintf(assistance.requestId,sizeof(assistance.requestId),"%s",previousId.c_str()); commandJournal = previousJournal;
    sendAck(ack,"REJECTED","PERSISTENCE_ERROR"); return;
  }
  recordEvent(action == "ACK_HELP" ? "HELP_ACKNOWLEDGED" : "HELP_CLOSED",request.c_str());
  sendAck(ack,"APPLIED","OK");
}
void updateConnectivity(unsigned long now) {
  if (inputs.motion != lastMotion) { lastMotion = inputs.motion; recordEvent(lastMotion ? "MOTION_STARTED" : "MOTION_ENDED"); }
  const bool light = lighting.appliedPwm > 0;
  if (light != lastLight) { lastLight = light; recordEvent(light ? "LIGHT_ON" : "LIGHT_OFF"); }
  if (!mqttClient) return;
  const bool ready = WiFi.status() == WL_CONNECTED && (!MQTT_USE_TLS || time(nullptr) >= 1704067200);
  if (!mqttStarted && ready) { mqttStarted = esp_mqtt_client_start(mqttClient) == ESP_OK; }
  if (mqttNeedsRetry && retryStartedMs == 0) retryStartedMs = now;
  if (mqttNeedsRetry && ready && now-retryStartedMs >= retryDelayMs) {
    esp_mqtt_client_reconnect(mqttClient); retryStartedMs = now; retryDelayMs = min(retryDelayMs*2,static_cast<uint32_t>(30000));
  }
  if (mqttJustConnected) {
    mqttJustConnected = false; retryDelayMs = 1000; retryStartedMs = 0; lastState = "";
    enqueueMqtt("availability","{\"schemaVersion\":1,\"deviceId\":\"" NIGHTCARE_DEVICE_ID "\",\"status\":\"online\"}",true);
    Serial.printf("[MQTT] Conectado com %s e QoS 1.\n", MQTT_USE_TLS ? "TLS" : "TCP demo publico");
  }
  InboundMessage incoming;
  // At most one command/configuration per iteration, leaving time for local inputs.
  if (xQueueReceive(inboundQueue,&incoming,0) == pdTRUE) {
    JsonDocument doc;
    if (!deserializeJson(doc,incoming.payload)) {
      if (strcmp(incoming.topic,configTopic.c_str()) == 0) applyRemoteConfig(doc);
      else if (strcmp(incoming.topic,commandsTopic.c_str()) == 0) applyRemoteCommand(doc,incoming.retained);
    }
  }
  int packetId;
  while (xQueueReceive(deliveryQueue,&packetId,0) == pdTRUE) {
    if (packetId == eventInFlight) eventInFlight = -1;
    for (size_t i=0;i<eventCount;++i) if(eventQueue[i].packetId == packetId) {
      for(size_t j=i;j+1<eventCount;++j) eventQueue[j]=eventQueue[j+1]; --eventCount; break;
    }
  }
  if (!mqttOnline) return;
  // One event in flight; keep the application copy until PUBACK, including across reconnection.
  if (eventInFlight >= 0 && now-eventInFlightSince >= 60000UL) eventInFlight = -1;
  if (eventCount && eventInFlight < 0) {
    auto& event = eventQueue[0];
    {
      const int id = enqueueMqtt("events",event.payload,false);
      if (id >= 0) { event.packetId = id; event.sentAt = now; eventInFlight = id; eventInFlightSince = now; }
    }
  }
  JsonDocument state; envelope(state); state["bootId"] = bootId;
  state["mode"] = modeName(); state["lightOn"] = light; state["brightnessPct"] = config.brightness;
  state["motion"] = inputs.motion; state["assistanceStatus"] = assistanceName();
  if (assistance.state == AssistanceState::NONE) state["requestId"] = nullptr; else state["requestId"] = assistance.requestId;
  state["pressCount"] = assistance.pressCount;
  state["clockValid"] = clockService.valid && clockService.testMode == -1;
  state["appliedConfigVersion"] = appliedConfigVersion; state["droppedEvents"] = droppedEvents;
  state["persistenceOk"] = storageReady && (assistance.state == AssistanceState::NONE || assistance.persisted);
  char startTime[6], endTime[6];
  snprintf(startTime,sizeof(startTime),"%02u:%02u",config.startMinute/60,config.startMinute%60);
  snprintf(endTime,sizeof(endTime),"%02u:%02u",config.endMinute/60,config.endMinute%60);
  state["runtimeSettings"]["offDelaySec"] = config.offDelaySec;
  state["runtimeSettings"]["startTime"] = startTime;
  state["runtimeSettings"]["endTime"] = endTime;
  state["runtimeSettings"]["timezoneOffsetHours"] = config.utcOffset;
  String comparable; serializeJson(state,comparable);
  if (comparable != lastState || now-lastHeartbeatMs >= 15000UL) {
    state["sequence"] = ++stateSequence; state["uptimeMs"] = now; String payload; serializeJson(state,payload);
    if(enqueueMqtt("state",payload,true)>=0) {lastState=comparable;lastHeartbeatMs=now;}
  }
}

// ---------- Inicializacao e loop ----------

void setup() {
  Serial.begin(115200);

  inputs.begin();
  lighting.begin();

  pinMode(STATUS_LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  digitalWrite(STATUS_LED_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);

  Serial.println();
  Serial.println("=== NightCare ===");

  char boot[17];
  snprintf(boot, sizeof(boot), "%08lx%08lx", static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()));
  bootId = boot;
  loadConfiguration();
  clockService.begin();
  assistance.begin();
  beginConnectivity();
  recordEvent("BOOT");
  if (assistance.state != AssistanceState::NONE) recordEvent("HELP_RECOVERED", assistance.requestId);

  printHelp();
  refreshLighting();
  printStatus();
}

void loop() {
  const unsigned long now = millis();

  inputs.update(now);
  clockService.update(now);

  lighting.update(
    now,
    inputs.motion,
    clockService.scheduleAllowsMotion()
  );

  assistance.update(now, inputs.buttonPressed);
  updateSerial();
  updateConnectivity(now);
}