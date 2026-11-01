#include <Arduino.h>
#include <WiFi.h>
#include <Preferences.h>
#include <time.h>
#include <stdlib.h>
#include <string.h>
#include <esp_random.h>
#include <limits.h>

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

    if (!connected && now - lastWifiAttemptMs >= 30000UL) {
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
    "1,%u,%u,%u,%u,%u,%d",
    static_cast<unsigned>(config.mode),
    static_cast<unsigned>(config.brightness),
    static_cast<unsigned>(config.offDelaySec),
    static_cast<unsigned>(config.startMinute),
    static_cast<unsigned>(config.endMinute),
    config.utcOffset
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

  const int fields = sscanf(
    stored.c_str(),
    "%u,%u,%u,%u,%u,%u,%d%n",
    &version,
    &mode,
    &brightness,
    &delaySec,
    &start,
    &end,
    &offset,
    &consumed
  );

  const bool valid =
    fields == 7 &&
    consumed == static_cast<int>(stored.length()) &&
    version == 1 &&
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

  char requestId[48] = "";
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
    snprintf(
      requestId,
      sizeof(requestId),
      "nightcare-001-%08lx%08lx",
      static_cast<unsigned long>(esp_random()),
      static_cast<unsigned long>(esp_random())
    );
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

    persisted = preferences.putString("help", record) > 0;

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

    const String record = preferences.getString("help", "");

    if (record.isEmpty()) {
      Serial.println("[ASSISTENCIA] Nenhum chamado salvo.");
      return;
    }

    unsigned version = 0;
    unsigned storedState = 0;
    unsigned long storedCount = 0;
    char storedId[48] = "";
    int consumed = 0;

    const int fields = sscanf(
      record.c_str(),
      "%u,%u,%lu,%47s%n",
      &version,
      &storedState,
      &storedCount,
      storedId,
      &consumed
    );

    bool validId =
      strlen(storedId) == 29 &&
      strncmp(storedId, "nightcare-001-", 13) == 0;

    if (validId) {
      for (size_t i = 13; i < 29; i++) {
        const char c = storedId[i];

        if (!((c >= '0' && c <= '9') ||
              (c >= 'a' && c <= 'f'))) {
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
  Serial.println("=== NightCare - Etapa 4 ===");

  loadConfiguration();
  clockService.begin();
  assistance.begin();

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
}