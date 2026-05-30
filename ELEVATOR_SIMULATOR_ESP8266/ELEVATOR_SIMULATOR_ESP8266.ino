#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>

/*
================================================================================
  ADVANCED ELEVATOR DIGITAL TWIN SIMULATOR — ESP8266 VERSION
  Adapted to behave like esp32_simulator.py

  Publishes the same Eclipse Ditto MQTT envelope:
  {
    "topic": "building/floor1:elevator/things/twin/commands/modify",
    "headers": { "content-type": "application/json" },
    "path": "/features",
    "value": { ... Ditto features ... }
  }

  Canonical MQTT topic convention (project-wide):
      elevator/{mqtt_safe_thing_id}/{telemetry|events|commands|status}
  The Ditto Thing ID "building:floor1:elevator" is unchanged; the topic uses
  the safe form "building-floor1-elevator" (':' -> '-').

  Required Arduino libraries:
  - ESP8266 board package
  - PubSubClient by Nick O'Leary
  - ArduinoJson by Benoit Blanchon
================================================================================
*/

// ──────────────────────────────────────────────────────────────────────────────
// 1. CONFIGURATION — edit for your Wi-Fi/MQTT environment
// ──────────────────────────────────────────────────────────────────────────────
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// ESP8266 cannot reach your PC with "localhost". Use your PC/LAN broker IP.
const char* MQTT_SERVER = "192.168.1.10";
const uint16_t MQTT_PORT = 1883;

const char* THING_ID = "building:floor1:elevator";
// MQTT-safe id (':' -> '-'). Keep in sync with THING_ID.
const char* MQTT_THING_ID = "building-floor1-elevator";
// Canonical topics: elevator/{mqtt_safe_thing_id}/{telemetry|events|commands|status}
const char* MQTT_TOPIC = "elevator/building-floor1-elevator/telemetry";
const char* MQTT_EVENTS_TOPIC = "elevator/building-floor1-elevator/events";
const char* MQTT_COMMANDS_TOPIC = "elevator/building-floor1-elevator/commands";
const char* MQTT_STATUS_TOPIC = "elevator/building-floor1-elevator/status";
const uint32_t PUBLISH_INTERVAL_MS = 3000;  // Python simulator default: 3 seconds

// If true: exactly mirrors Python Ditto envelope. If false: publishes { thingId, features }
// for dashboards that consume MQTT directly instead of Ditto Connectivity.
const bool PUBLISH_DITTO_ENVELOPE = true;

// MQTT/JSON buffer. Full Ditto envelope + incident log needs more than default 256 bytes.
const uint16_t MQTT_BUFFER_SIZE = 6144;
const size_t JSON_DOC_CAPACITY = 6144;

// ──────────────────────────────────────────────────────────────────────────────
// 2. ELEVATOR MODEL CONSTANTS — matched with esp32_simulator.py
// ──────────────────────────────────────────────────────────────────────────────
const uint8_t NUM_FLOORS = 4;  // 0..3, 0 = lobby
const uint8_t LOBBY_FLOOR = 0;

const float MAX_SPEED_MS = 1.8f;
const float ACCEL_RATE_MS2 = 0.3f;
const float DECEL_RATE_MS2 = 0.3f;
const float FLOOR_HEIGHT_M = 3.0f;
const float DOOR_OPEN_DWELL_S = 4.0f;
const float DOOR_TRAVEL_S = 2.0f;
const float MAX_LOAD_KG = 800.0f;
const float OVERLOAD_THRESHOLD = 0.95f;

const float MOTOR_IDLE_TEMP_C = 25.0f;
const float MOTOR_MAX_TEMP_C = 95.0f;
const float MOTOR_HEAT_RATE = 0.8f;
const float MOTOR_COOL_RATE = 0.4f;
const float MOTOR_DESIGN_LIFE_H = 10000.0f;

// ──────────────────────────────────────────────────────────────────────────────
// 3. STATE MACHINE ENUMS
// ──────────────────────────────────────────────────────────────────────────────
enum ElevatorPhase : uint8_t {
  PHASE_IDLE = 0,
  PHASE_DOOR_CLOSING,
  PHASE_ACCELERATING,
  PHASE_CRUISING,
  PHASE_DECELERATING,
  PHASE_DOOR_OPENING,
  PHASE_DOOR_DWELL,
  PHASE_EMERGENCY,
  PHASE_MAINTENANCE
};

enum Direction : int8_t {
  DIR_DOWN = -1,
  DIR_IDLE = 0,
  DIR_UP = 1
};

enum DoorState : uint8_t {
  DOOR_OPEN = 0,
  DOOR_CLOSED,
  DOOR_OPENING,
  DOOR_CLOSING,
  DOOR_BLOCKED
};

enum HealthStatus : uint8_t {
  HEALTH_GOOD = 0,
  HEALTH_WARNING,
  HEALTH_CRITICAL
};

enum AlertLevel : uint8_t {
  ALERT_NORMAL = 0,
  ALERT_CAUTION,
  ALERT_HIGH,
  ALERT_CRITICAL
};

const char* PHASE_NAMES[] = {
  "IDLE", "DOOR_CLOSING", "ACCELERATING", "CRUISING",
  "DECELERATING", "DOOR_OPENING", "DOOR_DWELL", "EMERGENCY", "MAINTENANCE"
};
const char* DIRECTION_NAMES[] = { "DOWN", "IDLE", "UP" };  // index = direction + 1
const char* DOOR_NAMES[] = { "OPEN", "CLOSED", "OPENING", "CLOSING", "BLOCKED" };
const char* HEALTH_NAMES[] = { "GOOD", "WARNING", "CRITICAL" };
const char* ALERT_NAMES[] = { "NORMAL", "CAUTION", "HIGH", "CRITICAL" };

// ──────────────────────────────────────────────────────────────────────────────
// 4. ANOMALIES — same names/probabilities as Python simulator
// ──────────────────────────────────────────────────────────────────────────────
struct AnomalyDef {
  const char* name;
  float probability;
};

const AnomalyDef ANOMALIES[] = {
  { "forced_door", 0.012f },
  { "unauthorized_rfid", 0.018f },
  { "motor_vibration_spike", 0.015f },
  { "audio_distress", 0.008f },
  { "emergency_button", 0.005f },
  { "overload", 0.010f },
  { "door_obstruction", 0.020f },
  { "motor_overheat", 0.006f },
  { "power_fluctuation", 0.009f },
  { "rfid_reader_fault", 0.007f },
  { "free_fall_vibration", 0.003f },
  { "stuck_between_floors", 0.004f }
};
const uint8_t NUM_ANOMALIES = sizeof(ANOMALIES) / sizeof(ANOMALIES[0]);
int anomalyTicksRemaining[NUM_ANOMALIES] = { 0 };

const char* AUTHORIZED_CARDS[] = {
  "CARD-A001", "CARD-A002", "CARD-B001", "CARD-MAINT-01", "CARD-SECURITY-01"
};
const uint8_t AUTHORIZED_CARD_COUNT = sizeof(AUTHORIZED_CARDS) / sizeof(AUTHORIZED_CARDS[0]);

// ──────────────────────────────────────────────────────────────────────────────
// 5. DATA STRUCTURES
// ──────────────────────────────────────────────────────────────────────────────
struct Incident {
  char incident_id[12];
  char ts[25];
  char type[32];
  char description[120];
  bool resolved;
};

struct ElevatorState {
  // Position & motion
  int current_floor;
  int target_floor;
  float position_m;
  float speed_ms;
  Direction direction;

  // Phase & doors
  ElevatorPhase phase;
  DoorState door_state;
  float door_timer_s;
  bool door_obstruction;
  uint32_t door_cycle_count;
  uint16_t obstruction_events;

  // Cabin
  float load_kg;
  float cabin_temp_c;
  bool emergency_stop;
  uint32_t trips_today;

  // Motor / mechanical
  float vibration_level;
  float motor_temp_c;
  float hours_operated;
  HealthStatus motor_health;

  // Derived electrical/energy telemetry
  float current_draw_a;
  float power_kw;
  float kwh_today;

  // Security
  bool audio_distress;
  bool forced_entry;
  uint16_t unauth_attempts;
  char rfid_last_card[24];
  bool rfid_access_granted;
  AlertLevel alert_level;

  // Counters
  uint32_t ticks_in_phase;
};

ElevatorState elevator;

const uint8_t MAX_QUEUE = 3;
int callQueue[MAX_QUEUE];
uint8_t callQueueLen = 0;

const uint8_t MAX_INCIDENTS = 20;
Incident incidents[MAX_INCIDENTS];
uint8_t incidentCount = 0;
uint32_t incidentSeq = 0;

WiFiClient espClient;
PubSubClient mqttClient(espClient);
uint32_t lastPublishMs = 0;
uint32_t tickCounter = 0;

// ──────────────────────────────────────────────────────────────────────────────
// 6. SMALL HELPERS
// ──────────────────────────────────────────────────────────────────────────────
float clampf(float value, float minValue, float maxValue) {
  if (value < minValue) return minValue;
  if (value > maxValue) return maxValue;
  return value;
}

int clampi(int value, int minValue, int maxValue) {
  if (value < minValue) return minValue;
  if (value > maxValue) return maxValue;
  return value;
}

float randomFloat(float minValue, float maxValue) {
  return minValue + (maxValue - minValue) * (random(0, 10000) / 10000.0f);
}

float jitter(float base, float sigma) {
  // Box-Muller transform, similar to random.gauss() in Python.
  float u1 = randomFloat(0.0001f, 0.9999f);
  float u2 = randomFloat(0.0001f, 0.9999f);
  float z0 = sqrtf(-2.0f * logf(u1)) * cosf(2.0f * PI * u2);
  float result = base + sigma * z0;
  return result < 0.0f ? 0.0f : result;
}

float roundTo(float value, float factor) {
  return roundf(value * factor) / factor;
}

String isoTimestamp() {
  time_t now = time(nullptr);
  if (now > 1700000000) {  // valid NTP-ish timestamp
    struct tm timeinfo;
    gmtime_r(&now, &timeinfo);
    char buf[25];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
    return String(buf);
  }
  return String("ms-") + String(millis());
}

void safeCopy(char* dest, size_t size, const char* src) {
  if (!dest || size == 0) return;
  strncpy(dest, src ? src : "", size - 1);
  dest[size - 1] = '\0';
}

const char* directionName(Direction direction) {
  return DIRECTION_NAMES[(int)direction + 1];
}

void transitionTo(ElevatorPhase nextPhase) {
  elevator.phase = nextPhase;
  elevator.ticks_in_phase = 0;

  if (nextPhase == PHASE_DOOR_CLOSING || nextPhase == PHASE_DOOR_OPENING) {
    elevator.door_timer_s = DOOR_TRAVEL_S;
  } else if (nextPhase == PHASE_DOOR_DWELL || nextPhase == PHASE_IDLE) {
    elevator.door_timer_s = DOOR_OPEN_DWELL_S;
  }
}

void logIncident(const char* type, const char* description) {
  if (incidentCount >= MAX_INCIDENTS) {
    for (uint8_t i = 1; i < MAX_INCIDENTS; i++) {
      incidents[i - 1] = incidents[i];
    }
    incidentCount = MAX_INCIDENTS - 1;
  }

  Incident& inc = incidents[incidentCount++];
  snprintf(inc.incident_id, sizeof(inc.incident_id), "INC-%05lu", ++incidentSeq);
  safeCopy(inc.ts, sizeof(inc.ts), isoTimestamp().c_str());
  safeCopy(inc.type, sizeof(inc.type), type);
  safeCopy(inc.description, sizeof(inc.description), description);
  inc.resolved = false;
}

uint8_t openIncidentCount() {
  uint8_t count = 0;
  for (uint8_t i = 0; i < incidentCount; i++) {
    if (!incidents[i].resolved) count++;
  }
  return count;
}

// ──────────────────────────────────────────────────────────────────────────────
// 7. WIFI + MQTT
// ──────────────────────────────────────────────────────────────────────────────
void setupWifi() {
  delay(100);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.println();
  Serial.print("Connecting Wi-Fi: ");
  Serial.println(WIFI_SSID);

  uint8_t attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 60) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ Wi-Fi connected");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n❌ Wi-Fi connection failed. Check SSID/password.");
  }
}

void setupClock() {
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("NTP sync");
  for (uint8_t i = 0; i < 12 && time(nullptr) < 1700000000; i++) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(time(nullptr) > 1700000000 ? " done" : " skipped");
}

void reconnectMqtt() {
  while (!mqttClient.connected()) {
    Serial.print("MQTT connecting...");
    String clientId = "elevator-twin-esp8266-" + String(ESP.getChipId(), HEX);

    if (mqttClient.connect(clientId.c_str())) {
      Serial.print(" connected to ");
      Serial.print(MQTT_SERVER);
      Serial.print(":");
      Serial.println(MQTT_PORT);
    } else {
      Serial.print(" failed rc=");
      Serial.print(mqttClient.state());
      Serial.println(" retry in 5s");
      delay(5000);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 8. PASSENGER CALL QUEUE — mirrors Python _maybe_queue_call + SCAN selection
// ──────────────────────────────────────────────────────────────────────────────
bool queueContains(int floor) {
  for (uint8_t i = 0; i < callQueueLen; i++) {
    if (callQueue[i] == floor) return true;
  }
  return false;
}

void removeQueueAt(uint8_t index) {
  if (index >= callQueueLen) return;
  for (uint8_t i = index + 1; i < callQueueLen; i++) {
    callQueue[i - 1] = callQueue[i];
  }
  callQueueLen--;
}

void maybeQueueCall() {
  if (callQueueLen >= MAX_QUEUE) return;

  // Python simulator: random.random() < 0.25
  if (random(0, 10000) < 2500) {
    int floor = random(0, NUM_FLOORS);
    if (floor != elevator.current_floor && !queueContains(floor)) {
      callQueue[callQueueLen++] = floor;
    }
  }
}

bool hasPendingCall() {
  return callQueueLen > 0;
}

void pickNextTarget() {
  if (!hasPendingCall()) return;

  int bestIndex = -1;
  int bestFloor = -1;

  if (elevator.direction == DIR_UP) {
    int nearestAbove = NUM_FLOORS + 1;
    for (uint8_t i = 0; i < callQueueLen; i++) {
      if (callQueue[i] > elevator.current_floor && callQueue[i] < nearestAbove) {
        nearestAbove = callQueue[i];
        bestIndex = i;
      }
    }
  } else if (elevator.direction == DIR_DOWN) {
    int nearestBelow = -1;
    for (uint8_t i = 0; i < callQueueLen; i++) {
      if (callQueue[i] < elevator.current_floor && callQueue[i] > nearestBelow) {
        nearestBelow = callQueue[i];
        bestIndex = i;
      }
    }
  }

  if (bestIndex < 0) {
    int nearestDistance = 999;
    for (uint8_t i = 0; i < callQueueLen; i++) {
      int d = abs(callQueue[i] - elevator.current_floor);
      if (d < nearestDistance) {
        nearestDistance = d;
        bestIndex = i;
      }
    }
  }

  bestFloor = callQueue[bestIndex];
  removeQueueAt(bestIndex);

  elevator.target_floor = bestFloor;
  elevator.direction = (bestFloor > elevator.current_floor) ? DIR_UP : DIR_DOWN;

  Serial.printf("  ↑↓ New call → Floor %d [%s] | Queue=%u\n",
                elevator.target_floor, directionName(elevator.direction), callQueueLen);
}

float simulatePassengerLoad() {
  // Weighted choices copied from Python: [0,65,130,195,260,390,520,680]
  const int loads[] = { 0, 65, 130, 195, 260, 390, 520, 680 };
  const int weights[] = { 20, 15, 15, 15, 12, 10, 8, 5 };
  const uint8_t n = sizeof(loads) / sizeof(loads[0]);
  int totalWeight = 0;
  for (uint8_t i = 0; i < n; i++) totalWeight += weights[i];

  int r = random(0, totalWeight);
  int cumulative = 0;
  int chosen = 0;
  for (uint8_t i = 0; i < n; i++) {
    cumulative += weights[i];
    if (r < cumulative) {
      chosen = loads[i];
      break;
    }
  }

  return clampf(chosen + randomFloat(-10.0f, 10.0f), 0.0f, MAX_LOAD_KG * 1.2f);
}

// ──────────────────────────────────────────────────────────────────────────────
// 9. PHYSICS ENGINE
// ──────────────────────────────────────────────────────────────────────────────
void updatePosition(float dt) {
  float delta = elevator.speed_ms * dt;
  if (elevator.direction == DIR_UP) {
    elevator.position_m += delta;
  } else if (elevator.direction == DIR_DOWN) {
    elevator.position_m -= delta;
  }

  elevator.position_m = clampf(elevator.position_m, 0.0f, (NUM_FLOORS - 1) * FLOOR_HEIGHT_M);
  elevator.current_floor = clampi((int)roundf(elevator.position_m / FLOOR_HEIGHT_M), 0, NUM_FLOORS - 1);
}

void checkArrival() {
  float targetPos = elevator.target_floor * FLOOR_HEIGHT_M;
  float distRemaining = fabsf(targetPos - elevator.position_m);
  float brakingDistance = (elevator.speed_ms * elevator.speed_ms) / (2.0f * DECEL_RATE_MS2);

  if (distRemaining <= brakingDistance + 0.05f) {
    if (elevator.phase == PHASE_CRUISING || elevator.phase == PHASE_ACCELERATING) {
      transitionTo(PHASE_DECELERATING);
    }
  }
}

void snapToFloor() {
  elevator.current_floor = elevator.target_floor;
  elevator.position_m = elevator.target_floor * FLOOR_HEIGHT_M;
  elevator.speed_ms = 0.0f;
  elevator.hours_operated += (FLOOR_HEIGHT_M / MAX_SPEED_MS) / 3600.0f;
  elevator.trips_today++;
  Serial.printf("  ↳ Arrived at floor %d\n", elevator.current_floor);
}

void updateMotorThermal(float dt) {
  float dtFactor = dt / (PUBLISH_INTERVAL_MS / 1000.0f);

  if (elevator.phase == PHASE_ACCELERATING || elevator.phase == PHASE_CRUISING || elevator.phase == PHASE_DECELERATING) {
    float loadFactor = 1.0f + (elevator.load_kg / MAX_LOAD_KG) * 0.5f;
    elevator.motor_temp_c += MOTOR_HEAT_RATE * loadFactor * dtFactor;
  } else {
    elevator.motor_temp_c -= MOTOR_COOL_RATE * dtFactor;
  }

  elevator.motor_temp_c = clampf(elevator.motor_temp_c, MOTOR_IDLE_TEMP_C, MOTOR_MAX_TEMP_C);
  elevator.cabin_temp_c = 22.0f + (elevator.motor_temp_c - MOTOR_IDLE_TEMP_C) * 0.04f + randomFloat(-0.2f, 0.2f);
}

void updateMotorHealth() {
  if (elevator.vibration_level > 0.25f || elevator.motor_temp_c > 85.0f) {
    elevator.motor_health = HEALTH_CRITICAL;
  } else if (elevator.vibration_level > 0.12f || elevator.motor_temp_c > 70.0f) {
    elevator.motor_health = HEALTH_WARNING;
  } else {
    elevator.motor_health = HEALTH_GOOD;
  }
}

void updateElectricalTelemetry() {
  float loadRatio = clampf(elevator.load_kg / MAX_LOAD_KG, 0.0f, 1.5f);
  bool moving = elevator.phase == PHASE_ACCELERATING || elevator.phase == PHASE_CRUISING || elevator.phase == PHASE_DECELERATING;

  if (moving) {
    elevator.current_draw_a = 4.5f + loadRatio * 2.5f + randomFloat(-0.15f, 0.15f);
  } else {
    elevator.current_draw_a = 0.8f + randomFloat(-0.05f, 0.05f);
  }

  elevator.current_draw_a = clampf(elevator.current_draw_a, 0.0f, 30.0f);
  elevator.power_kw = roundTo(elevator.current_draw_a * 0.4f, 100.0f);
  elevator.kwh_today += (elevator.power_kw * (PUBLISH_INTERVAL_MS / 1000.0f)) / 3600.0f;
}

void phaseIdle(float dt) {
  elevator.speed_ms = 0.0f;
  elevator.direction = DIR_IDLE;
  elevator.vibration_level = jitter(0.005f, 0.002f);

  if (elevator.ticks_in_phase == 1) {
    elevator.door_state = DOOR_OPEN;
    elevator.door_timer_s = DOOR_OPEN_DWELL_S;
    elevator.load_kg = simulatePassengerLoad();
  }

  elevator.door_timer_s -= dt;
  if (elevator.door_timer_s <= 0.0f && hasPendingCall()) {
    pickNextTarget();
    transitionTo(PHASE_DOOR_CLOSING);
  }
}

void phaseDoorClosing(float dt) {
  elevator.door_state = DOOR_CLOSING;
  elevator.speed_ms = 0.0f;

  if (elevator.door_obstruction) {
    elevator.door_state = DOOR_BLOCKED;
    elevator.obstruction_events++;
    logIncident("DOOR_OBSTRUCTION", "Door blocked while closing");
    transitionTo(PHASE_DOOR_OPENING);
    return;
  }

  elevator.door_timer_s -= dt;
  if (elevator.door_timer_s <= 0.0f) {
    elevator.door_state = DOOR_CLOSED;
    elevator.load_kg = simulatePassengerLoad();
    elevator.door_cycle_count++;
    transitionTo(PHASE_ACCELERATING);
  }
}

void phaseAccelerating(float dt) {
  elevator.door_state = DOOR_CLOSED;
  elevator.speed_ms = clampf(elevator.speed_ms + ACCEL_RATE_MS2 * dt, 0.0f, MAX_SPEED_MS);
  updatePosition(dt);
  elevator.vibration_level = jitter(0.06f, 0.015f) + (elevator.speed_ms / MAX_SPEED_MS) * 0.04f;

  if (elevator.speed_ms >= MAX_SPEED_MS * 0.99f) {
    transitionTo(PHASE_CRUISING);
  }
  checkArrival();
}

void phaseCruising(float dt) {
  elevator.speed_ms = MAX_SPEED_MS;
  elevator.vibration_level = jitter(0.05f, 0.012f);
  updatePosition(dt);
  checkArrival();
}

void phaseDecelerating(float dt) {
  elevator.speed_ms = clampf(elevator.speed_ms - DECEL_RATE_MS2 * dt, 0.0f, MAX_SPEED_MS);
  elevator.vibration_level = jitter(0.045f, 0.010f);
  updatePosition(dt);

  if (elevator.speed_ms <= 0.01f) {
    snapToFloor();
    transitionTo(PHASE_DOOR_OPENING);
  }
}

void phaseDoorOpening(float dt) {
  elevator.speed_ms = 0.0f;
  elevator.door_state = DOOR_OPENING;
  elevator.vibration_level = jitter(0.005f, 0.002f);
  elevator.door_timer_s -= dt;

  if (elevator.door_timer_s <= 0.0f) {
    elevator.door_state = DOOR_OPEN;
    transitionTo(PHASE_DOOR_DWELL);
  }
}

void phaseDoorDwell(float dt) {
  elevator.door_state = DOOR_OPEN;
  elevator.speed_ms = 0.0f;
  elevator.vibration_level = jitter(0.005f, 0.002f);
  elevator.door_timer_s -= dt;

  if (elevator.door_timer_s <= 0.0f) {
    if (hasPendingCall()) {
      pickNextTarget();
      transitionTo(PHASE_DOOR_CLOSING);
    } else {
      elevator.load_kg = 0.0f;
      transitionTo(PHASE_IDLE);
    }
  }
}

void clearEmergency() {
  elevator.emergency_stop = false;
  elevator.alert_level = ALERT_NORMAL;
  transitionTo(PHASE_IDLE);
  logIncident("EMERGENCY_CLEARED", "Emergency cleared — returning to service");
  Serial.println("✅ Emergency cleared — returning to service");
}

void requestEmergencyStop(const char* reason) {
  if (!elevator.emergency_stop) {
    elevator.emergency_stop = true;
    elevator.speed_ms = 0.0f;
    elevator.alert_level = ALERT_CRITICAL;
    logIncident("EMERGENCY_STOP", reason);
    Serial.print("🛑 EMERGENCY STOP — ");
    Serial.println(reason);
  }
}

void phaseEmergency(float dt) {
  (void)dt;
  elevator.speed_ms = 0.0f;
  elevator.vibration_level = jitter(0.003f, 0.001f);
  elevator.direction = DIR_IDLE;

  // Python simulator auto-clears after 30 ticks, simulating engineer response.
  if (elevator.ticks_in_phase > 30) {
    clearEmergency();
  }
}

void phaseMaintenance(float dt) {
  (void)dt;
  elevator.speed_ms = 0.0f;
  elevator.vibration_level = jitter(0.008f, 0.003f);
  elevator.direction = DIR_IDLE;
}

void decaySecurityState() {
  // Python resets transient RFID reader state after one physics tick.
  if (!elevator.rfid_access_granted && strcmp(elevator.rfid_last_card, "") != 0) {
    // Keep the last card visible, but restore reader status.
    elevator.rfid_access_granted = true;
  }
}

void tickPhysics(float dt) {
  elevator.ticks_in_phase++;
  maybeQueueCall();

  if (elevator.emergency_stop && elevator.phase != PHASE_EMERGENCY) {
    transitionTo(PHASE_EMERGENCY);
  }

  switch (elevator.phase) {
    case PHASE_IDLE: phaseIdle(dt); break;
    case PHASE_DOOR_CLOSING: phaseDoorClosing(dt); break;
    case PHASE_ACCELERATING: phaseAccelerating(dt); break;
    case PHASE_CRUISING: phaseCruising(dt); break;
    case PHASE_DECELERATING: phaseDecelerating(dt); break;
    case PHASE_DOOR_OPENING: phaseDoorOpening(dt); break;
    case PHASE_DOOR_DWELL: phaseDoorDwell(dt); break;
    case PHASE_EMERGENCY: phaseEmergency(dt); break;
    case PHASE_MAINTENANCE: phaseMaintenance(dt); break;
  }

  updateMotorThermal(dt);
  updateMotorHealth();
  updateElectricalTelemetry();
  decaySecurityState();
}

// ──────────────────────────────────────────────────────────────────────────────
// 10. ANOMALY ENGINE
// ──────────────────────────────────────────────────────────────────────────────
void clearAnomaly(uint8_t index) {
  const char* name = ANOMALIES[index].name;

  if (strcmp(name, "forced_door") == 0) {
    elevator.forced_entry = false;
    if (elevator.alert_level == ALERT_CRITICAL) elevator.alert_level = ALERT_CAUTION;
    if (elevator.door_state == DOOR_BLOCKED) elevator.door_state = DOOR_OPEN;
  } else if (strcmp(name, "audio_distress") == 0) {
    elevator.audio_distress = false;
  } else if (strcmp(name, "door_obstruction") == 0) {
    elevator.door_obstruction = false;
  } else if (strcmp(name, "overload") == 0) {
    elevator.load_kg = simulatePassengerLoad();
  } else if (strcmp(name, "motor_vibration_spike") == 0 || strcmp(name, "free_fall_vibration") == 0) {
    elevator.vibration_level = 0.02f;
  }
}

void tickActiveAnomalies() {
  for (uint8_t i = 0; i < NUM_ANOMALIES; i++) {
    if (anomalyTicksRemaining[i] > 0) {
      anomalyTicksRemaining[i]--;
      if (anomalyTicksRemaining[i] == 0) {
        clearAnomaly(i);
      }
    }
  }
}

void applyAnomaly(const char* name, uint8_t index) {
  char description[120];

  if (strcmp(name, "forced_door") == 0) {
    elevator.forced_entry = true;
    elevator.alert_level = ALERT_CRITICAL;
    elevator.door_state = DOOR_BLOCKED;
    logIncident("FORCED_ENTRY", "Door forced entry detected by reed switch");
    anomalyTicksRemaining[index] = 3;

  } else if (strcmp(name, "unauthorized_rfid") == 0) {
    snprintf(elevator.rfid_last_card, sizeof(elevator.rfid_last_card), "UNKNOWN_%04ld", random(1000, 10000));
    elevator.rfid_access_granted = false;
    elevator.unauth_attempts++;
    if (elevator.unauth_attempts >= 3) elevator.alert_level = ALERT_HIGH;
    snprintf(description, sizeof(description), "Card %s denied — not in whitelist", elevator.rfid_last_card);
    logIncident("UNAUTHORIZED_RFID", description);
    anomalyTicksRemaining[index] = 1;

  } else if (strcmp(name, "motor_vibration_spike") == 0) {
    elevator.vibration_level = randomFloat(0.18f, 0.45f);
    elevator.motor_health = HEALTH_WARNING;
    snprintf(description, sizeof(description), "Vibration spike: %.4fg", elevator.vibration_level);
    logIncident("VIBRATION_SPIKE", description);
    anomalyTicksRemaining[index] = 2;

  } else if (strcmp(name, "audio_distress") == 0) {
    elevator.audio_distress = true;
    elevator.alert_level = ALERT_CRITICAL;
    logIncident("DISTRESS_AUDIO", "Passenger distress audio detected by MEMS mic");
    anomalyTicksRemaining[index] = 4;

  } else if (strcmp(name, "emergency_button") == 0) {
    requestEmergencyStop("Emergency button pressed by passenger");
    anomalyTicksRemaining[index] = 30;

  } else if (strcmp(name, "overload") == 0) {
    elevator.load_kg = MAX_LOAD_KG * randomFloat(1.02f, 1.15f);
    elevator.alert_level = ALERT_HIGH;
    snprintf(description, sizeof(description), "Cabin overloaded: %.0fkg > %.0fkg", elevator.load_kg, MAX_LOAD_KG);
    logIncident("OVERLOAD", description);
    anomalyTicksRemaining[index] = 2;

  } else if (strcmp(name, "door_obstruction") == 0) {
    if (elevator.phase == PHASE_DOOR_CLOSING || elevator.phase == PHASE_IDLE || elevator.phase == PHASE_DOOR_DWELL) {
      elevator.door_obstruction = true;
      elevator.door_state = DOOR_BLOCKED;
      elevator.obstruction_events++;
      logIncident("DOOR_OBSTRUCTION", "Door blocked by foreign object");
      anomalyTicksRemaining[index] = 2;
    }

  } else if (strcmp(name, "motor_overheat") == 0) {
    elevator.motor_temp_c = clampf(elevator.motor_temp_c + randomFloat(15.0f, 25.0f), MOTOR_IDLE_TEMP_C, MOTOR_MAX_TEMP_C);
    elevator.motor_health = HEALTH_CRITICAL;
    snprintf(description, sizeof(description), "Motor temperature critical: %.1f°C", elevator.motor_temp_c);
    logIncident("MOTOR_OVERHEAT", description);
    anomalyTicksRemaining[index] = 5;

  } else if (strcmp(name, "power_fluctuation") == 0) {
    elevator.cabin_temp_c += randomFloat(1.5f, 4.0f);
    elevator.vibration_level += randomFloat(0.02f, 0.05f);
    logIncident("POWER_FLUCTUATION", "Voltage fluctuation detected");
    anomalyTicksRemaining[index] = 1;

  } else if (strcmp(name, "rfid_reader_fault") == 0) {
    safeCopy(elevator.rfid_last_card, sizeof(elevator.rfid_last_card), "ERR_HARDWARE");
    elevator.rfid_access_granted = false;
    elevator.alert_level = ALERT_CAUTION;
    logIncident("RFID_FAULT", "RC522 reader hardware fault");
    anomalyTicksRemaining[index] = 2;

  } else if (strcmp(name, "free_fall_vibration") == 0) {
    elevator.vibration_level = randomFloat(0.50f, 0.95f);
    elevator.motor_health = HEALTH_CRITICAL;
    elevator.alert_level = ALERT_CRITICAL;
    requestEmergencyStop("Extreme vibration — possible cable fault");
    snprintf(description, sizeof(description), "Extreme vibration: %.4fg", elevator.vibration_level);
    logIncident("FREE_FALL_VIBRATION", description);
    anomalyTicksRemaining[index] = 10;

  } else if (strcmp(name, "stuck_between_floors") == 0) {
    if (elevator.phase == PHASE_CRUISING || elevator.phase == PHASE_ACCELERATING) {
      requestEmergencyStop("Elevator stuck between floors — encoder fault");
      logIncident("STUCK_BETWEEN_FLOORS", "Elevator halted mid-shaft");
      anomalyTicksRemaining[index] = 20;
    }
  }
}

String rollAnomalies() {
  tickActiveAnomalies();
  String triggered = "";

  for (uint8_t i = 0; i < NUM_ANOMALIES; i++) {
    float effectiveProb = ANOMALIES[i].probability;
    if (anomalyTicksRemaining[i] > 0) effectiveProb *= 0.1f;

    if (randomFloat(0.0f, 1.0f) < effectiveProb) {
      applyAnomaly(ANOMALIES[i].name, i);
      if (triggered.length() > 0) triggered += ",";
      triggered += ANOMALIES[i].name;
    }
  }

  return triggered;
}

// ──────────────────────────────────────────────────────────────────────────────
// 11. DITTO PAYLOAD BUILDER
// ──────────────────────────────────────────────────────────────────────────────
float healthIndex() {
  float risk = 0.0f;
  risk += elevator.forced_entry ? 45.0f : 0.0f;
  risk += elevator.audio_distress ? 40.0f : 0.0f;
  risk += elevator.motor_temp_c > 85.0f ? 20.0f : 0.0f;
  risk += elevator.vibration_level > 0.125f ? 20.0f : 0.0f;
  risk += (elevator.load_kg / MAX_LOAD_KG) > OVERLOAD_THRESHOLD ? 15.0f : 0.0f;
  return clampf(100.0f - risk * 0.65f, 10.0f, 100.0f);
}

int riskScore() {
  int score = 0;
  if (elevator.forced_entry) score += 45;
  if (elevator.audio_distress) score += 40;
  if (!elevator.rfid_access_granted && strlen(elevator.rfid_last_card) > 0) score += 20;
  if (elevator.motor_temp_c > 85.0f) score += 20;
  if (elevator.vibration_level > 0.125f) score += 20;
  if ((elevator.load_kg / MAX_LOAD_KG) > 1.0f) score += 35;
  else if ((elevator.load_kg / MAX_LOAD_KG) > OVERLOAD_THRESHOLD) score += 15;
  return clampi(score, 0, 100);
}

void addFeatureTree(JsonObject root) {
  JsonObject cabin = root.createNestedObject("cabin");
  JsonObject cabinProps = cabin.createNestedObject("properties");
  cabinProps["current_floor"] = elevator.current_floor;
  cabinProps["target_floor"] = elevator.target_floor;
  cabinProps["direction"] = directionName(elevator.direction);
  cabinProps["load_kg"] = roundTo(elevator.load_kg, 10.0f);
  cabinProps["max_load_kg"] = MAX_LOAD_KG;
  cabinProps["temperature_c"] = roundTo(elevator.cabin_temp_c, 10.0f);
  cabinProps["speed_ms"] = roundTo(elevator.speed_ms, 1000.0f);
  cabinProps["emergency_stop"] = elevator.emergency_stop;
  cabinProps["trips_today"] = elevator.trips_today;

  JsonObject door = root.createNestedObject("door");
  JsonObject doorProps = door.createNestedObject("properties");
  doorProps["state"] = DOOR_NAMES[elevator.door_state];
  doorProps["door_forced_entry"] = elevator.forced_entry;
  doorProps["cycle_count"] = elevator.door_cycle_count;
  doorProps["obstruction_events"] = elevator.obstruction_events;
  doorProps["force_sensor_n"] = elevator.door_obstruction ? random(120, 350) : random(0, 20);

  JsonObject motor = root.createNestedObject("motor");
  JsonObject motorProps = motor.createNestedObject("properties");
  motorProps["vibration_level"] = roundTo(elevator.vibration_level, 10000.0f);
  motorProps["vibration_g"] = roundTo(elevator.vibration_level, 10000.0f);  // alias for n8n agents
  motorProps["vibration_baseline_g"] = 0.05f;
  motorProps["hours_operated"] = roundTo(elevator.hours_operated, 100.0f);
  motorProps["health_status"] = HEALTH_NAMES[elevator.motor_health];
  motorProps["temperature_c"] = roundTo(elevator.motor_temp_c, 10.0f);
  motorProps["current_draw_a"] = roundTo(elevator.current_draw_a, 10.0f);
  motorProps["power_kw"] = roundTo(elevator.power_kw, 100.0f);

  JsonObject security = root.createNestedObject("security");
  JsonObject securityProps = security.createNestedObject("properties");
  securityProps["audio_distress_active"] = elevator.audio_distress;
  securityProps["unauthorized_access_attempts"] = elevator.unauth_attempts;
  securityProps["rfid_last_card"] = elevator.rfid_last_card;
  securityProps["rfid_access_granted"] = elevator.rfid_access_granted;
  securityProps["alert_level"] = ALERT_NAMES[elevator.alert_level];

  JsonObject incidentLog = root.createNestedObject("incident_log");
  JsonObject incidentProps = incidentLog.createNestedObject("properties");
  JsonArray entries = incidentProps.createNestedArray("entries");
  uint8_t start = incidentCount > 10 ? incidentCount - 10 : 0;
  for (uint8_t i = start; i < incidentCount; i++) {
    JsonObject item = entries.createNestedObject();
    item["incident_id"] = incidents[i].incident_id;
    item["ts"] = incidents[i].ts;
    item["type"] = incidents[i].type;
    item["description"] = incidents[i].description;
    item["resolved"] = incidents[i].resolved;
  }
  incidentProps["open_incidents"] = openIncidentCount();

  // Extra dashboard/agent-friendly features. They do not break Ditto; they enrich the twin.
  JsonObject energy = root.createNestedObject("energy");
  JsonObject energyProps = energy.createNestedObject("properties");
  energyProps["kwh_today"] = roundTo(elevator.kwh_today, 1000.0f);
  energyProps["power_kw"] = roundTo(elevator.power_kw, 100.0f);

  JsonObject performance = root.createNestedObject("performance");
  JsonObject performanceProps = performance.createNestedObject("properties");
  performanceProps["avg_wait_s"] = 18 + random(-3, 4);
  performanceProps["avg_trip_s"] = 24 + random(-4, 5);
  performanceProps["availability_pct"] = elevator.emergency_stop ? 97.5f : 99.4f;
  performanceProps["door_cycle_efficiency"] = elevator.obstruction_events > 0 ? 88.0f : 94.0f;

  JsonObject predicted = root.createNestedObject("predicted_failures");
  JsonObject predictedProps = predicted.createNestedObject("properties");
  predictedProps["motor_rul_hours"] = (int)clampf(MOTOR_DESIGN_LIFE_H - elevator.hours_operated, 0.0f, MOTOR_DESIGN_LIFE_H);
  predictedProps["bearing_health_pct"] = (int)clampf(100.0f - elevator.vibration_level * 100.0f, 1.0f, 100.0f);
  predictedProps["door_mechanism_pct"] = (int)clampf(100.0f - elevator.obstruction_events * 2.0f, 40.0f, 100.0f);
  predictedProps["rope_tension_pct"] = elevator.vibration_level > 0.5f ? 65 : 92;
}

bool publishTelemetry() {
#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  DynamicJsonDocument doc(JSON_DOC_CAPACITY);
#endif

  if (PUBLISH_DITTO_ENVELOPE) {
    doc["topic"] = "building/floor1:elevator/things/twin/commands/modify";
    doc["headers"]["content-type"] = "application/json";
    doc["path"] = "/features";
    JsonObject value = doc.createNestedObject("value");
    addFeatureTree(value);
  } else {
    doc["thingId"] = THING_ID;
    doc["updatedAt"] = isoTimestamp();
    JsonObject attributes = doc.createNestedObject("attributes");
    attributes["thing_id"] = THING_ID;
    attributes["system_mode"] = elevator.emergency_stop ? "MAINTENANCE" : "NORMAL";
    attributes["risk_score"] = riskScore();
    attributes["system_health_index"] = roundTo(healthIndex(), 10.0f);
    JsonObject features = doc.createNestedObject("features");
    addFeatureTree(features);
  }

  char payload[MQTT_BUFFER_SIZE];
  size_t len = serializeJson(doc, payload, sizeof(payload));

  if (len == 0 || len >= sizeof(payload)) {
    Serial.println("JSON serialization failed or MQTT buffer too small");
    return false;
  }

  bool ok = mqttClient.publish(MQTT_TOPIC, payload);
  if (ok) {
    Serial.printf("Published %u bytes | Tick:%lu Floor:%d->%d Phase:%s Door:%s Vib:%.4fg Motor:%.1fC Risk:%d\n",
                  (unsigned)len,
                  tickCounter,
                  elevator.current_floor,
                  elevator.target_floor,
                  PHASE_NAMES[elevator.phase],
                  DOOR_NAMES[elevator.door_state],
                  elevator.vibration_level,
                  elevator.motor_temp_c,
                  riskScore());
  } else {
    Serial.printf("MQTT publish failed. Payload bytes=%u State=%d\n", (unsigned)len, mqttClient.state());
  }

  return ok;
}

// ──────────────────────────────────────────────────────────────────────────────
// 12. INITIALIZATION + MAIN LOOP
// ──────────────────────────────────────────────────────────────────────────────
void initElevator() {
  elevator.current_floor = LOBBY_FLOOR;
  elevator.target_floor = LOBBY_FLOOR;
  elevator.position_m = LOBBY_FLOOR * FLOOR_HEIGHT_M;
  elevator.speed_ms = 0.0f;
  elevator.direction = DIR_IDLE;

  elevator.phase = PHASE_IDLE;
  elevator.door_state = DOOR_OPEN;
  elevator.door_timer_s = DOOR_OPEN_DWELL_S;
  elevator.door_obstruction = false;
  elevator.door_cycle_count = 0;
  elevator.obstruction_events = 0;

  elevator.load_kg = 0.0f;
  elevator.cabin_temp_c = 22.0f;
  elevator.emergency_stop = false;
  elevator.trips_today = 0;

  elevator.vibration_level = 0.01f;
  elevator.motor_temp_c = MOTOR_IDLE_TEMP_C;
  elevator.hours_operated = randomFloat(800.0f, 2500.0f);
  elevator.motor_health = HEALTH_GOOD;

  elevator.current_draw_a = 0.8f;
  elevator.power_kw = 0.32f;
  elevator.kwh_today = 0.0f;

  elevator.audio_distress = false;
  elevator.forced_entry = false;
  elevator.unauth_attempts = 0;
  safeCopy(elevator.rfid_last_card, sizeof(elevator.rfid_last_card), AUTHORIZED_CARDS[random(0, AUTHORIZED_CARD_COUNT)]);
  elevator.rfid_access_granted = true;
  elevator.alert_level = ALERT_NORMAL;

  elevator.ticks_in_phase = 0;
  callQueueLen = 0;
  incidentCount = 0;
  incidentSeq = 0;

  Serial.printf("[INIT] Elevator ready | Floor:%d | Motor hours:%.1f | Thing:%s\n",
                elevator.current_floor, elevator.hours_operated, THING_ID);
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  randomSeed(analogRead(A0) ^ micros());
  initElevator();

  setupWifi();
  setupClock();

  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setBufferSize(MQTT_BUFFER_SIZE);
  mqttClient.setKeepAlive(60);

  Serial.println("============================================================");
  Serial.println("  ESP8266 Elevator Digital Twin Simulator");
  Serial.print("  Thing ID : ");
  Serial.println(THING_ID);
  Serial.print("  MQTT    : ");
  Serial.print(MQTT_SERVER);
  Serial.print(":");
  Serial.println(MQTT_PORT);
  Serial.print("  Topic   : ");
  Serial.println(MQTT_TOPIC);
  Serial.print("  Format  : ");
  Serial.println(PUBLISH_DITTO_ENVELOPE ? "Ditto envelope" : "Raw twin patch");
  Serial.println("============================================================");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    setupWifi();
  }

  if (!mqttClient.connected()) {
    reconnectMqtt();
  }
  mqttClient.loop();

  uint32_t now = millis();
  if (now - lastPublishMs >= PUBLISH_INTERVAL_MS) {
    lastPublishMs = now;
    tickCounter++;

    float dt = PUBLISH_INTERVAL_MS / 1000.0f;

    // Same order as Python: physics tick → anomaly roll → build/publish payload.
    tickPhysics(dt);
    String triggered = rollAnomalies();
    if (triggered.length() > 0) {
      Serial.print("⚡ Triggered anomalies: ");
      Serial.println(triggered);
    }
    publishTelemetry();
  }
}
