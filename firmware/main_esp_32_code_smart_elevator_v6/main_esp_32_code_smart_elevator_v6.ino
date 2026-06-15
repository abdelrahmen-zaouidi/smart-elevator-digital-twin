#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <string.h>
#include <time.h>
#include <sys/time.h>  // settimeofday() for the offline-LAN TLS clock fallback

#ifndef ENABLE_RFID
#define ENABLE_RFID 1
#endif

#if ENABLE_RFID
#include <SPI.h>
#include <MFRC522.h>
#endif


#ifndef ENABLE_LCD
#define ENABLE_LCD 1  // override with -DENABLE_LCD=0 to build without the I2C HMI
#endif
#define LCD_I2C_ADDRESS 0x27
#define LCD_COLS 16
#define LCD_ROWS 4
#define LCD_SDA_PIN 17
#define LCD_SCL_PIN 18
#define LCD_I2C_CLOCK_HZ 50000
#define LCD_UPDATE_INTERVAL_MS 500
#define LCD_UPDATE_WHILE_MOVING 0
#define LCD_TEMP_MESSAGE_DURATION_MS 1800
#define LCD_SHOW_TELEMETRY 1
#define LCD_SHOW_RFID_STATUS 1

#if ENABLE_LCD
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#endif

// =====================================================
// PIN CONFIGURATION  --  CHANGE PINS HERE ONLY
// =====================================================

// Stepper microstep driver
#define STEP_PIN 39  // PUL-
#define DIR_PIN 40   // DIR-

// Door motor L298N / HW-095
#define DOOR_IN1_PIN 38
#define DOOR_IN2_PIN 37
#define DOOR_EN_PIN 36

// Fan relay JQC3F-05VDC-C module
#define FAN_RELAY_PIN 16

// Outside buttons (hall calls)
#define OUT_F0_UP_PIN 9
#define OUT_F1_UP_PIN 11
#define OUT_F1_DOWN_PIN 10
#define OUT_F2_UP_PIN 13
#define OUT_F2_DOWN_PIN 12
#define OUT_F3_DOWN_PIN 14

// Cabin buttons
#define CABIN_F0_PIN 1
#define CABIN_F1_PIN 2
#define CABIN_F2_PIN 42
#define CABIN_F3_PIN 41

// Hardware emergency-stop input.
// Wire the push button between GPIO35 and GND. The internal pull-up keeps the
// input HIGH normally; pressing the button pulls it LOW and enters EMERGENCY.
#define EMERGENCY_STOP_PIN 35
const bool EMERGENCY_STOP_ACTIVE_LOW = true;

// Analog simulation potentiometers. ESP32-S3 GPIO4/5/6 are ADC1-capable pins
// (ADC1_CH3/CH4/CH5) and are not used elsewhere in this firmware.
#define SIM_TEMP_ADC_PIN 4
#define SIM_VIB_ADC_PIN 5
#define SIM_LOAD_ADC_PIN 6

// RC522 RFID reader. This is the tested wiring and SPI pinout for the thesis
// prototype; keep it fixed unless the hardware bench test proves otherwise.
#if ENABLE_RFID
#define RFID_SS_PIN 45  // RC522 SDA / SS
#define RFID_RST_PIN 20
#define RFID_SCK_PIN 48
#define RFID_MISO_PIN 21
#define RFID_MOSI_PIN 47
#endif

// Acoustic alert output. GPIO47 is reserved for the tested RC522 MISO line, so
// the buzzer is moved to GPIO20. If your ESP32-S3 board uses native USB on
// GPIO19/GPIO20 during runtime, move this define to another free output.
// Do not use GPIO26..32 on common ESP32-S3 modules: those pins are tied to
// the internal flash/PSRAM SPI bus and can cause watchdog boot loops.
// Drive a transistor/MOSFET input from this pin; do not power a 3-24 V buzzer
// directly from the ESP32 GPIO unless the buzzer module current is known safe.
#define BUZZER_PIN 19

#if BUZZER_PIN >= 26 && BUZZER_PIN <= 32
#error "BUZZER_PIN is on ESP32-S3 flash/PSRAM pins GPIO26..32. Use an exposed free GPIO instead."
#endif

#if BUZZER_PIN == 19 || BUZZER_PIN == 20
#warning "GPIO19/GPIO20 are native USB pins on many ESP32-S3 boards. Use this buzzer pin only if it is free on your board."
#endif

#if ENABLE_RFID && ((RFID_SS_PIN >= 26 && RFID_SS_PIN <= 32) || (RFID_RST_PIN >= 26 && RFID_RST_PIN <= 32) || (RFID_SCK_PIN >= 26 && RFID_SCK_PIN <= 32) || (RFID_MISO_PIN >= 26 && RFID_MISO_PIN <= 32) || (RFID_MOSI_PIN >= 26 && RFID_MOSI_PIN <= 32))
#error "RFID pins must not use ESP32-S3 flash/PSRAM GPIO26..32."
#endif

#if ENABLE_RFID && (RFID_SS_PIN == 0 || RFID_SS_PIN == 3 || RFID_SS_PIN == 45 || RFID_SS_PIN == 46 || RFID_RST_PIN == 0 || RFID_RST_PIN == 3 || RFID_RST_PIN == 45 || RFID_RST_PIN == 46 || RFID_SCK_PIN == 0 || RFID_SCK_PIN == 3 || RFID_SCK_PIN == 45 || RFID_SCK_PIN == 46 || RFID_MISO_PIN == 0 || RFID_MISO_PIN == 3 || RFID_MISO_PIN == 45 || RFID_MISO_PIN == 46 || RFID_MOSI_PIN == 0 || RFID_MOSI_PIN == 3 || RFID_MOSI_PIN == 45 || RFID_MOSI_PIN == 46)
#warning "One or more RFID pins are ESP32-S3 boot-strapping pins on many modules. This warning is expected for the tested thesis wiring."
#endif

#if ENABLE_RFID && (RFID_SS_PIN == RFID_RST_PIN || RFID_SS_PIN == RFID_SCK_PIN || RFID_SS_PIN == RFID_MISO_PIN || RFID_SS_PIN == RFID_MOSI_PIN || RFID_RST_PIN == RFID_SCK_PIN || RFID_RST_PIN == RFID_MISO_PIN || RFID_RST_PIN == RFID_MOSI_PIN || RFID_SCK_PIN == RFID_MISO_PIN || RFID_SCK_PIN == RFID_MOSI_PIN || RFID_MISO_PIN == RFID_MOSI_PIN)
#error "RFID SPI pins must be unique."
#endif

#define PIN_CONFLICTS_WITH_ELEVATOR_GPIO(P) ( \
  (P) == STEP_PIN || (P) == DIR_PIN || (P) == DOOR_IN1_PIN || (P) == DOOR_IN2_PIN || (P) == DOOR_EN_PIN || (P) == FAN_RELAY_PIN || (P) == OUT_F0_UP_PIN || (P) == OUT_F1_UP_PIN || (P) == OUT_F1_DOWN_PIN || (P) == OUT_F2_UP_PIN || (P) == OUT_F2_DOWN_PIN || (P) == OUT_F3_DOWN_PIN || (P) == CABIN_F0_PIN || (P) == CABIN_F1_PIN || (P) == CABIN_F2_PIN || (P) == CABIN_F3_PIN || (P) == EMERGENCY_STOP_PIN || (P) == SIM_TEMP_ADC_PIN || (P) == SIM_VIB_ADC_PIN || (P) == SIM_LOAD_ADC_PIN || (P) == BUZZER_PIN || (ENABLE_LCD && ((P) == LCD_SDA_PIN || (P) == LCD_SCL_PIN)))

#if ENABLE_RFID && (PIN_CONFLICTS_WITH_ELEVATOR_GPIO(RFID_SS_PIN) || PIN_CONFLICTS_WITH_ELEVATOR_GPIO(RFID_RST_PIN) || PIN_CONFLICTS_WITH_ELEVATOR_GPIO(RFID_SCK_PIN) || PIN_CONFLICTS_WITH_ELEVATOR_GPIO(RFID_MISO_PIN) || PIN_CONFLICTS_WITH_ELEVATOR_GPIO(RFID_MOSI_PIN))
#error "RFID pins conflict with an existing elevator GPIO assignment."
#endif

#if ENABLE_LCD && (LCD_SDA_PIN == LCD_SCL_PIN)
#error "LCD_SDA_PIN and LCD_SCL_PIN must be different ESP32-S3 GPIO numbers."
#endif

#if ENABLE_LCD && ((LCD_SDA_PIN >= 26 && LCD_SDA_PIN <= 32) || (LCD_SCL_PIN >= 26 && LCD_SCL_PIN <= 32))
#error "LCD I2C pins must not use ESP32-S3 flash/PSRAM GPIO26..32."
#endif

#if ENABLE_LCD && (LCD_SDA_PIN == 19 || LCD_SDA_PIN == 20 || LCD_SCL_PIN == 19 || LCD_SCL_PIN == 20)
#warning "GPIO19/GPIO20 are commonly used by native USB on ESP32-S3 boards. Prefer different LCD I2C pins."
#endif

#if ENABLE_LCD && (LCD_SDA_PIN == 0 || LCD_SDA_PIN == 3 || LCD_SDA_PIN == 45 || LCD_SDA_PIN == 46 || LCD_SCL_PIN == 0 || LCD_SCL_PIN == 3 || LCD_SCL_PIN == 45 || LCD_SCL_PIN == 46)
#warning "Selected LCD I2C pin is an ESP32-S3 boot-strapping pin on many modules. Prefer non-strap GPIO."
#endif

#if ENABLE_LCD && (LCD_SDA_PIN == STEP_PIN || LCD_SDA_PIN == DIR_PIN || LCD_SDA_PIN == DOOR_IN1_PIN || LCD_SDA_PIN == DOOR_IN2_PIN || LCD_SDA_PIN == DOOR_EN_PIN || LCD_SDA_PIN == FAN_RELAY_PIN || LCD_SDA_PIN == OUT_F0_UP_PIN || LCD_SDA_PIN == OUT_F1_UP_PIN || LCD_SDA_PIN == OUT_F1_DOWN_PIN || LCD_SDA_PIN == OUT_F2_UP_PIN || LCD_SDA_PIN == OUT_F2_DOWN_PIN || LCD_SDA_PIN == OUT_F3_DOWN_PIN || LCD_SDA_PIN == CABIN_F0_PIN || LCD_SDA_PIN == CABIN_F1_PIN || LCD_SDA_PIN == CABIN_F2_PIN || LCD_SDA_PIN == CABIN_F3_PIN || LCD_SDA_PIN == EMERGENCY_STOP_PIN || LCD_SDA_PIN == SIM_TEMP_ADC_PIN || LCD_SDA_PIN == SIM_VIB_ADC_PIN || LCD_SDA_PIN == SIM_LOAD_ADC_PIN || LCD_SDA_PIN == BUZZER_PIN || LCD_SCL_PIN == STEP_PIN || LCD_SCL_PIN == DIR_PIN || LCD_SCL_PIN == DOOR_IN1_PIN || LCD_SCL_PIN == DOOR_IN2_PIN || LCD_SCL_PIN == DOOR_EN_PIN || LCD_SCL_PIN == FAN_RELAY_PIN || LCD_SCL_PIN == OUT_F0_UP_PIN || LCD_SCL_PIN == OUT_F1_UP_PIN || LCD_SCL_PIN == OUT_F1_DOWN_PIN || LCD_SCL_PIN == OUT_F2_UP_PIN || LCD_SCL_PIN == OUT_F2_DOWN_PIN || LCD_SCL_PIN == OUT_F3_DOWN_PIN || LCD_SCL_PIN == CABIN_F0_PIN || LCD_SCL_PIN == CABIN_F1_PIN || LCD_SCL_PIN == CABIN_F2_PIN || LCD_SCL_PIN == CABIN_F3_PIN || LCD_SCL_PIN == EMERGENCY_STOP_PIN || LCD_SCL_PIN == SIM_TEMP_ADC_PIN || LCD_SCL_PIN == SIM_VIB_ADC_PIN || LCD_SCL_PIN == SIM_LOAD_ADC_PIN || LCD_SCL_PIN == BUZZER_PIN)
#error "LCD I2C pins conflict with an existing elevator GPIO assignment."
#endif

// Example secrets.h:
//   #define SECRET_WIFI_SSID     "MyNetwork"
//   #define SECRET_WIFI_PASSWORD "supersecret"
//   #define SECRET_MQTT_SERVER   "192.168.1.10"
//   #define SECRET_MQTT_USERNAME "elevator"     // optional broker auth
//   #define SECRET_MQTT_PASSWORD "brokerpass"
// =====================================================
#if defined(__has_include)
#if __has_include("secrets.h")
#include "secrets.h"
#endif
#endif

#ifndef SECRET_WIFI_SSID
#define SECRET_WIFI_SSID "YOUR_WIFI_SSID"  // fallback - prefer secrets.h
#endif
#ifndef SECRET_WIFI_PASSWORD
#define SECRET_WIFI_PASSWORD "YOUR_WIFI_PASSWORD"  // fallback - prefer secrets.h
#endif
#ifndef SECRET_MQTT_SERVER
#define SECRET_MQTT_SERVER "192.168.1.10"  // fallback - prefer secrets.h
#endif
// Empty username/password => anonymous connect (preserves current behavior).
// Set these (ideally via secrets.h) once the broker enforces auth/ACLs.
#ifndef SECRET_MQTT_USERNAME
#define SECRET_MQTT_USERNAME ""
#endif
#ifndef SECRET_MQTT_PASSWORD
#define SECRET_MQTT_PASSWORD ""
#endif

// ---- MQTT TLS (security item 1) --------------------------------------------
// 1 = connect over TLS on port 8883; the ESP32 pins the broker CA below
//     (server-only TLS). Recommended secure default; this is the only hop that
//     crosses WiFi.
// 0 = plaintext on 1883 (auth-only fallback if TLS misbehaves on the bench).
// Requires NTP time sync (done in setup) so the cert validity window checks.
#ifndef MQTT_USE_TLS
#define MQTT_USE_TLS 1
#endif

// Offline-LAN TLS clock fallback. The elevator LAN may have NO internet, so the
// public-NTP sync below can fail; the ESP32 clock then stays at 1970 and the
// pinned broker cert looks "not yet valid", making TLS fail with PubSubClient
// rc=-2. When NTP is unreachable we fall back to this fixed epoch, which MUST
// sit inside the broker server.crt validity window (i.e. >= its notBefore).
// Bump it if you reissue the cert with a later notBefore --
// scripts/reissue-server-cert.sh prints the new notBefore. Override in secrets.h.
#if MQTT_USE_TLS
#ifndef TLS_TIME_FALLBACK_EPOCH
#define TLS_TIME_FALLBACK_EPOCH 1781395200UL  // 2026-06-14T00:00:00Z
#endif
#endif

// NTP time source order. The elevator LAN is isolated (no internet), so the PC /
// broker host runs a LOCAL NTP server and is the PRIMARY source. The D-Link
// gateway (manually set, a few seconds off) is the secondary, and public NTP the
// tertiary (reachable only if the LAN ever gains internet). If all fail, setup()
// applies TLS_TIME_FALLBACK_EPOCH so TLS still validates. Override in secrets.h.
#if MQTT_USE_TLS
#ifndef SECRET_NTP_SERVER
#define SECRET_NTP_SERVER SECRET_MQTT_SERVER  // broker host doubles as the LAN NTP authority
#endif
#ifndef NTP_SERVER_GATEWAY
#define NTP_SERVER_GATEWAY "192.168.10.1"     // D-Link gateway fallback
#endif
#ifndef NTP_SERVER_PUBLIC
#define NTP_SERVER_PUBLIC "pool.ntp.org"      // used only if the LAN gains internet
#endif
#endif

// Broker CA certificate the ESP32 pins to validate the server. This is the
// PUBLIC ca.crt from scripts/gen-mqtt-certs.sh (a certificate, NOT a private
// key), so embedding it in firmware is safe. If you REGENERATE the CA you MUST
// replace this value (or override it via secrets.h) or TLS validation fails.
#if MQTT_USE_TLS
#ifndef MQTT_CA_CERT
#define MQTT_CA_CERT R"EOF(
-----BEGIN CERTIFICATE-----
MIIBzjCCAXWgAwIBAgIUG7mCUeVHrggbwUVf9k42as5xatUwCgYIKoZIzj0EAwIw
PTEfMB0GA1UEAwwWU21hcnRFbGV2YXRvciBMb2NhbCBDQTEaMBgGA1UECgwRU21h
cnRFbGV2YXRvclR3aW4wHhcNMjYwNTI4MTgzOTU1WhcNMzEwNTI3MTgzOTU1WjA9
MR8wHQYDVQQDDBZTbWFydEVsZXZhdG9yIExvY2FsIENBMRowGAYDVQQKDBFTbWFy
dEVsZXZhdG9yVHdpbjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABC6igMxdVxJ4
bLVILMayrcbR6x+RuHbsNQfK+KZXJoQoLGz9BaO9tk989vr45ICnQXYhyBr16QVI
HYwEmz2bdlqjUzBRMB0GA1UdDgQWBBQagDWlG7B9VDggvO658CH8zykIzDAfBgNV
HSMEGDAWgBQagDWlG7B9VDggvO658CH8zykIzDAPBgNVHRMBAf8EBTADAQH/MAoG
CCqGSM49BAMCA0cAMEQCIDYr8vhzxAym76DH6rDX4MXczbPKnA+ZWx/wqTRqpCe+
AiBJGEs2Vs8mSdZd3IkvjItepxvNpdDhY0j9owYO4htv9A==
-----END CERTIFICATE-----
)EOF"
#endif
#endif

const char* WIFI_SSID = SECRET_WIFI_SSID;
const char* WIFI_PASSWORD = SECRET_WIFI_PASSWORD;
const char* MQTT_SERVER = SECRET_MQTT_SERVER;
const char* MQTT_USERNAME = SECRET_MQTT_USERNAME;
const char* MQTT_PASSWORD = SECRET_MQTT_PASSWORD;

#if MQTT_USE_TLS
const uint16_t MQTT_PORT = 8883;  // mqtts (TLS)
#else
const uint16_t MQTT_PORT = 1883;  // plaintext fallback
#endif

const char* THING_ID = "building:floor1:elevator";
const char* MQTT_THING_ID = "building-floor1-elevator";

const char* MQTT_TELEMETRY_TOPIC = "elevator/building-floor1-elevator/telemetry";
const char* MQTT_EVENTS_TOPIC = "elevator/building-floor1-elevator/events";
const char* MQTT_COMMANDS_TOPIC = "elevator/building-floor1-elevator/commands";
const char* MQTT_STATUS_TOPIC = "elevator/building-floor1-elevator/status";

// UI/alert feature flags.
#define ENABLE_BUZZER 1
#define ENABLE_WARNING_ALERTS 1

const unsigned long PUBLISH_INTERVAL_MS = 3000;
const unsigned long MQTT_RETRY_MS = 5000;
const unsigned long MQTT_STATUS_PUBLISH_MS = 5000;
const uint16_t MQTT_KEEPALIVE_SECONDS = 10;
const uint16_t MQTT_SOCKET_TIMEOUT_SECONDS = 3;
const size_t JSON_DOC_CAPACITY = 6144;

// H1: emit a compact cabin position update at trip start and at each floor-
// boundary crossing while MOVING, so the digital twin / SCADA shows the car
// actually moving instead of frozen telemetry until arrival. Published only a
// few times per trip (NOT per step), so the brief socket write does not
// meaningfully disturb step timing. Set to 0 to restore the original
// "no telemetry while moving" behaviour if your hardware proves timing-sensitive.
#define PUBLISH_POSITION_WHILE_MOVING 1


// =====================================================
// TUNABLE SETTINGS  --  GROUPED FOR EASY TWEAKING
// =====================================================

// Topology
const int NUM_FLOORS = 4;
const int START_FLOOR = 0;
const float FLOOR_HEIGHT_M = 3.0f;

// ADC simulation ranges. Pots must be wired to 3.3 V and GND only; never 5 V.
const bool SIM_ADC_ENABLED = true;
const int SIM_ADC_RESOLUTION_BITS = 12;
const int SIM_ADC_MAX_RAW = (1 << SIM_ADC_RESOLUTION_BITS) - 1;
const unsigned long SIM_ADC_UPDATE_MS = 250;
const unsigned long SIM_ADC_MOVING_UPDATE_MS = 500;
const unsigned long SIM_ADC_PRINT_MS = 2000;
const uint8_t SIM_ADC_AVG_SAMPLES = 8;
const uint8_t SIM_ADC_MOVING_AVG_SAMPLES = 1;
const float SIM_ADC_RISE_ALPHA = 0.35f;
const float SIM_ADC_RECOVERY_ALPHA = 0.70f;
const bool SIM_ADC_UPDATE_WHILE_MOVING = true;
const float SIM_TEMP_MIN_C = 20.0f;
const float SIM_TEMP_MAX_C = 100.0f;
const float SIM_VIB_MIN_G = 0.000f;
const float SIM_VIB_MAX_G = 0.600f;
const float SIM_LOAD_MIN_KG = 0.0f;
const float SIM_LOAD_MAX_KG = 1000.0f;
const float SIM_CABIN_TEMP_BASE_C = 24.0f;
const float SIM_CABIN_TEMP_LOAD_GAIN_C = 6.0f;
const float SIM_CABIN_TEMP_MOTOR_GAIN = 0.05f;
const float SIM_TEMP_WARNING_C = 70.0f;
const float SIM_TEMP_CRITICAL_C = 85.0f;
const float SIM_VIB_WARNING_G = 0.120f;
const float SIM_VIB_CRITICAL_G = 0.250f;
const float SIM_LOAD_RATED_KG = 800.0f;
const bool ENABLE_ADC_SAFETY_INTERLOCK = true;
const bool ENABLE_OVERLOAD_MOVEMENT_LOCKOUT = true;
const unsigned long ADC_SAFETY_FAULT_CONFIRM_MS = 2000;
// Critical ADC safety faults are confirmed before ERROR_STOP so one noisy
// sample cannot trip the elevator. Overload blocks dispatch immediately while
// confirmation is pending.

// Fan AUTO thresholds. Motor activity and temperature have priority; door
// opening/closing does not start or extend the fan timer.
const float FAN_MOTOR_ON_TEMP_C = 55.0f;
const float FAN_MOTOR_OFF_TEMP_C = 45.0f;
const float FAN_CABIN_ON_TEMP_C = 30.0f;
const float FAN_CRITICAL_MOTOR_TEMP_C = 75.0f;
// JQC3F-05VDC-C is a current-sinking relay module: the opto-LED sits between
// the module's 5 V VCC and the IN pin. The ESP32 must SINK current through
// IN to turn the relay ON, and must stop driving IN to turn it OFF.
//   ON  = OUTPUT LOW          (ESP32 sinks current, opto LED conducts)
//   OFF = INPUT/high-Z        (same observed behavior as disconnecting IN)
// Note: OUTPUT HIGH at 3.3 V is NOT enough -- 5 V - 3.3 V = 1.7 V still
// drops across the opto LED, which keeps it dimly conducting and the relay
// can latch ON on some 5 V relay modules. If INPUT_PULLUP still energizes
// this module, use plain INPUT so the ESP32 stops sourcing or sinking current.
const bool FAN_RELAY_ACTIVE_LOW = true;

// Stepper polarity. Flip if UP / DOWN feel reversed.
bool DIR_UP_ACTIVE_LOW = true;

// Stepper speed envelope.
// stepDelay starts at SLOW for the first STEP_ACCEL_STEPS pulses, ramps
// linearly to FAST, cruises, then ramps back to SLOW over the last
// STEP_DECEL_STEPS pulses before arrival.
const int STEP_DELAY_FAST_US = 900;
const int STEP_DELAY_SLOW_US = 1500;
const int STEP_PULSE_WIDTH_US = 8;

// ---- STEP-COUNT POSITIONING (V6 core change) -------------------------------
// STEPS_PER_FLOOR is THE calibration knob. Tune it once on your hardware:
//   1. Park cabin precisely at floor 0.
//   2. Send the cabin to floor 1.
//   3. Measure overshoot/undershoot in mm.
//   4. New = Old * (true floor height / measured travel). Re-flash and repeat.
// A reasonable first guess for the V5 timing of 4.89 s/floor at 900 µs cruise
// is about 4500 — but ALWAYS measure on your hardware.
const long STEPS_PER_FLOOR = 4500;

// Length of the soft-start and soft-stop ramps, in step pulses (not ms).
// Must satisfy: STEP_ACCEL_STEPS + STEP_DECEL_STEPS < STEPS_PER_FLOOR.
const unsigned long STEP_ACCEL_STEPS = 600;
const unsigned long STEP_DECEL_STEPS = 600;

// Wall-clock safety timeout PER FLOOR. If the step count hasn't completed
// in this window the firmware assumes a mechanical stall and trips
// ERROR_STOP. Should be comfortably larger than the expected per-floor time.
const unsigned long MAX_FLOOR_TRAVEL_MS = 10000;

// Door timing and polarity. Flip DOOR_INVERT once if open/close are reversed.
bool DOOR_INVERT = false;
const unsigned long DOOR_PULSE_MS = 505;     // motor power-on window
const unsigned long DOOR_DWELL_MS = 5000;    // open dwell
const unsigned long ARRIVE_SETTLE_MS = 200;  // pause between stop and door
int DOOR_SPEED = 200;                        // 0..255 PWM

// Fan auto-cooling timers (see cooling algorithm in updateFanAuto).
const unsigned long FAN_AFTER_RUN_MS = 8000;
const unsigned long FAN_HOT_RUN_MS = 30000;
const unsigned long FAN_HOT_COOLDOWN_MS = 60000;

// Direct GPIO buzzer mode for a small active DC buzzer only:
//   buzzer + -> ESP32 3V3
//   buzzer - -> BUZZER_PIN
//   GPIO LOW turns ON by sinking current, INPUT_PULLUP turns OFF.
// Do not use this direct mode if the buzzer draws more than about 10-12 mA.
const bool BUZZER_ACTIVE_HIGH = false;
const bool BUZZER_OFF_USES_INPUT_PULLUP = true;
const unsigned long WARNING_ALERT_CONFIRM_MS = 1500;
const unsigned long BUZZER_DIAGNOSTIC_HOLD_MS = 2000;

// Button debounce
const unsigned long DEBOUNCE_MS = 80;

// Inter-request grace: how long after a door cycle before we dispatch the
// next requested floor. Replaces the previous blocking delay(300) hack.
const unsigned long INTERREQUEST_GRACE_MS = 300;

// Collective-control request table. Requests are stored as flags, not as a
// FIFO, so duplicate button presses cannot create duplicate stops.
const bool CLEAR_ALL_HALL_CALLS_ON_STOP = true;

// RFID access-control policy. The default is thesis-prototype friendly:
// unrestricted floors remain usable without a card, while restricted floors
// require an active authorized RFID session when the reader is available.
const unsigned long RFID_POLL_INTERVAL_MS = 100;
const unsigned long RFID_SESSION_MS = 10000;
const unsigned long RFID_PRIORITY_WINDOW_MS = 30000;
// ACCESS CONTROL (Objective 1 + WHO/WHERE pairing).
// Physical presses from the in-cabin panel ("CABIN ...") and the outside hall
// panel ("OUT ...") require an authorized card. The single RC522 acts as "four
// virtual floor readers": the hall button tells us WHERE the call comes from and
// the card tells us WHO is calling. A press with no covering session is parked
// as "awaiting card" and dispatched only after a valid scan (either order works
// within RFID_PENDING_AUTH_WINDOW_MS). Trusted remote sources (MQTT/SCADA,
// serial) are never card-gated, so the dashboard/dispatch engine keep working.
// Set either flag false to restore card-free buttons for that panel.
const bool RFID_REQUIRE_AUTH_FOR_CABIN_CALLS = true;
const bool RFID_REQUIRE_AUTH_FOR_HALL_CALLS = true;
// Reader missing/faulty (rfidReady == false): true = physical calls still work
// (demo-friendly degrade-OPEN, the original behaviour); false = no reader means
// no physical service (fail-CLOSED, stricter security). Remote calls unaffected.
const bool RFID_CABIN_DEGRADE_OPEN = false;
// How long a physical press is remembered as "awaiting card" before it is
// dropped if no authorized card is presented (covers the press-then-scan order).
const unsigned long RFID_PENDING_AUTH_WINDOW_MS = 15000;
const bool RFID_SECURITY_CARD_UNLOCKS_LOCKDOWN = true;
const uint8_t RFID_RESTRICTED_FLOOR_MASK = (uint8_t)(1U << 3);  // floor 3


// =====================================================
// STATE MACHINE
// =====================================================
enum ElevatorState {
  ST_IDLE,
  ST_DOOR_OPENING,
  ST_DOOR_OPEN_WAIT,
  ST_DOOR_CLOSING,
  ST_MOVING_UP,
  ST_MOVING_DOWN,
  ST_ARRIVED,
  ST_ERROR_STOP,
  ST_EMERGENCY
};

ElevatorState state = ST_IDLE;
ElevatorState prevState = ST_IDLE;
unsigned long stateEnteredMs = 0;
unsigned long graceUntilMs = 0;  // earliest ms at which a waiting request may dispatch

int currentFloor = START_FLOOR;
int targetFloor = -1;
int segmentTargetFloor = -1;
int dispatchDirection = 0;  // -1 = down, 0 = idle, +1 = up

// V6: positioning is by step count, not wall-clock time.
unsigned long moveStartMs = 0;     // kept for safety timeout + telemetry
unsigned long stepsToDeliver = 0;  // total step pulses for this trip
unsigned long stepsDelivered = 0;  // counter, incremented per stepOnce()
unsigned long maxMoveTimeMs = 0;   // safety: trip aborts after this

// V6.1: continuous multi-floor travel. The trip is planned in one go all the
// way to targetFloor (stepsToDeliver = STEPS_PER_FLOOR * floors_to_travel),
// so the acceleration/deceleration ramp in currentStepDelayUs() engages once
// at trip start and once at the actual stop instead of at every floor
// boundary. stepsSinceLastBoundary tracks progress within the current floor
// segment so we can update currentFloor as boundaries are physically
// crossed and react to same-direction pickups appearing mid-trip.
unsigned long stepsSinceLastBoundary = 0;

// Position-memory across an emergency stop. When EMERGENCY interrupts a
// trip mid-shaft, we save how many steps were still owed to the target
// floor so RESET / hardware-clear can resume the trip exactly where it
// stopped instead of pretending we are on the origin floor.
bool resumePendingMove = false;
int resumeTargetFloor = -1;
int resumeSegmentTargetFloor = -1;
unsigned long resumeStepsRemaining = 0;
unsigned long resumeStepsSinceLastBoundary = 0;
bool resumeDirectionUp = false;

unsigned long tripsToday = 0;
unsigned long doorCycleCount = 0;

// Hardware E-STOP button (GPIO35): first press triggers emergency, second
// press (after a release) clears it and resumes the interrupted trip. The
// "released-since-trigger" flag prevents the same press that entered
// EMERGENCY from being read as the clearing press.
bool emergencyButtonRawReading = false;       // last raw debounced level
bool emergencyButtonStablePressed = false;    // current debounced state
unsigned long emergencyButtonLastEdgeMs = 0;  // ms of last raw level change
bool emergencyButtonReleasedInEmergency = false;
char lastFaultReason[33] = "NONE";


// =====================================================
// REQUEST TABLE   (collective control, deduplicated flags)
// =====================================================
enum RequestType {
  REQ_CABIN,
  REQ_HALL_UP,
  REQ_HALL_DOWN
};

bool cabinRequests[NUM_FLOORS];
bool hallUpRequests[NUM_FLOORS];
bool hallDownRequests[NUM_FLOORS];

const char* requestTypeName(RequestType type) {
  switch (type) {
    case REQ_CABIN: return "CABIN";
    case REQ_HALL_UP: return "HALL_UP";
    case REQ_HALL_DOWN: return "HALL_DOWN";
  }
  return "?";
}

int requestTypeDirection(RequestType type) {
  if (type == REQ_HALL_UP) return 1;
  if (type == REQ_HALL_DOWN) return -1;
  return 0;
}

bool isValidFloor(int floor) {
  return floor >= 0 && floor < NUM_FLOORS;
}

bool isValidHallRequest(int floor, RequestType type) {
  if (!isValidFloor(floor)) return false;
  if (type == REQ_HALL_UP) return floor < NUM_FLOORS - 1;
  if (type == REQ_HALL_DOWN) return floor > 0;
  return true;
}

bool hasRequestAtFloor(int floor) {
  if (!isValidFloor(floor)) return false;
  return cabinRequests[floor] || hallUpRequests[floor] || hallDownRequests[floor];
}

bool hasAnyPendingRequest() {
  for (int floor = 0; floor < NUM_FLOORS; floor++) {
    if (hasRequestAtFloor(floor)) return true;
  }
  return false;
}

int pendingRequestCount() {
  int count = 0;
  for (int floor = 0; floor < NUM_FLOORS; floor++) {
    if (cabinRequests[floor]) count++;
    if (hallUpRequests[floor]) count++;
    if (hallDownRequests[floor]) count++;
  }
  return count;
}

bool hasRequestsAbove(int floor) {
  for (int f = floor + 1; f < NUM_FLOORS; f++) {
    if (hasRequestAtFloor(f)) return true;
  }
  return false;
}

bool hasRequestsBelow(int floor) {
  for (int f = floor - 1; f >= 0; f--) {
    if (hasRequestAtFloor(f)) return true;
  }
  return false;
}

bool hasCompatibleRequestAtFloor(int floor, int direction) {
  if (!isValidFloor(floor)) return false;
  if (cabinRequests[floor]) return true;
  if (direction > 0 && hallUpRequests[floor]) return true;
  if (direction < 0 && hallDownRequests[floor]) return true;
  return false;
}

void requestTableClear() {
  for (int floor = 0; floor < NUM_FLOORS; floor++) {
    cabinRequests[floor] = false;
    hallUpRequests[floor] = false;
    hallDownRequests[floor] = false;
  }
}

void clearServedRequestsAtFloor(int floor, int direction, bool clearAllHall) {
  if (!isValidFloor(floor)) return;
  cabinRequests[floor] = false;
  if (clearAllHall || direction > 0) hallUpRequests[floor] = false;
  if (clearAllHall || direction < 0) hallDownRequests[floor] = false;
}

void dumpRequestTable() {
  Serial.print("[REQTAB] cabin=");
  for (int f = 0; f < NUM_FLOORS; f++)
    if (cabinRequests[f]) Serial.print(f);
  Serial.print(" up=");
  for (int f = 0; f < NUM_FLOORS; f++)
    if (hallUpRequests[f]) Serial.print(f);
  Serial.print(" down=");
  for (int f = 0; f < NUM_FLOORS; f++)
    if (hallDownRequests[f]) Serial.print(f);
  Serial.print(" dir=");
  Serial.print(dispatchDirection > 0 ? "UP" : dispatchDirection < 0 ? "DOWN"
                                                                    : "IDLE");
  Serial.print(" pending=");
  Serial.println(pendingRequestCount());
}


// =====================================================
// FAN STATE
// =====================================================
enum FanMode { FAN_MODE_AUTO,
               FAN_MODE_MANUAL };
FanMode fanMode = FAN_MODE_AUTO;
bool fanIsOn = false;
bool fanManualState = false;
bool fanHardwareRequestedOn = false;
const char* fanReason = "IDLE";
unsigned long fanRuntimeMsToday = 0;
unsigned long fanLastOnMs = 0;
unsigned long lastFanActivityMs = 0;
unsigned long lastHotRunEndedMs = 0;

// =====================================================
// ANALOG SIMULATION TELEMETRY
// =====================================================
int simTempRaw = 0;
int simVibRaw = 0;
int simLoadRaw = 0;
float simulatedTemperatureC = SIM_TEMP_MIN_C;
float simulatedVibrationG = SIM_VIB_MIN_G;
float simulatedLoadKg = SIM_LOAD_MIN_KG;
float simulatedCabinTemperatureC = SIM_CABIN_TEMP_BASE_C;
bool simTelemetryInitialized = false;
unsigned long lastSimAdcUpdateMs = 0;
unsigned long lastSimAdcPrintMs = 0;

// =====================================================
// RFID / SECURITY ACCESS MODEL
// =====================================================
enum RfidDisplayState {
  RFID_NO_CARD,
  RFID_AUTH,
  RFID_DENIED,
  RFID_ADMIN,
  RFID_USER,
  RFID_MAINT,
  RFID_VIP,
  RFID_SECURITY,
  RFID_RESTRICTED,
  RFID_LOCKED
};

enum RfidRole {
  ROLE_UNKNOWN,
  ROLE_UNAUTHORIZED,
  ROLE_RESTRICTED,
  ROLE_REGULAR,
  ROLE_VIP,
  ROLE_ADMIN,
  ROLE_MAINTENANCE,
  ROLE_SECURITY
};

struct RfidUser {
  const char* uid;
  const char* name;
  RfidRole role;
  uint8_t floorMask;
  int8_t preferredFloor;
  bool priority;
  bool maintenanceAccess;
  bool securityAccess;
  bool revoked;
};

const uint8_t RFID_ALL_FLOORS_MASK = (uint8_t)((1U << NUM_FLOORS) - 1U);

// Replace these demo UIDs with the uppercase UID printed by the Serial Monitor
// when your tested RC522 cards are scanned.
const RfidUser RFID_USERS[] = {
  { "A1B2C3D4", "VIP Demo", ROLE_VIP, RFID_ALL_FLOORS_MASK, 3, true, false, false, false },
  { "E7D97C05", "Administrator", ROLE_ADMIN, RFID_ALL_FLOORS_MASK, 0, true, true, true, false },
  { "C1C2C3D4", "Maintenance", ROLE_MAINTENANCE, RFID_ALL_FLOORS_MASK, 0, false, true, false, false },
  { "D1D2D3D4", "Security", ROLE_SECURITY, RFID_ALL_FLOORS_MASK, 0, false, false, true, false },
  { "E1E2E3D4", "Regular User", ROLE_REGULAR, (uint8_t)0x07, 1, false, false, false, false },
  { "BADCAFE0", "Restricted User", ROLE_RESTRICTED, (uint8_t)0x01, 0, false, false, false, false },
  { "43E49C04", "Revoked Test", ROLE_REGULAR, (uint8_t)0, -1, false, false, false, true }
};
const size_t RFID_USER_COUNT = sizeof(RFID_USERS) / sizeof(RFID_USERS[0]);

#if ENABLE_RFID
MFRC522 rfidReader(RFID_SS_PIN, RFID_RST_PIN);
#endif

RfidDisplayState rfidDisplayState = RFID_NO_CARD;
char lastRfidUid[25] = "----";
char lastRfidRole[13] = "NONE";
char lastRfidReason[33] = "NO CARD";
char activeRfidUid[25] = "----";
char activeRfidUserName[21] = "NONE";
char activeRfidRoleName[13] = "NONE";
RfidRole activeRfidRole = ROLE_UNKNOWN;
uint8_t activeRfidFloorMask = 0;
unsigned long activeRfidSessionUntilMs = 0;
bool rfidReady = false;
bool rfidModuleFault = false;
bool rfidDegradedNoticePrinted = false;
bool lastRfidAuthorized = false;
bool securityLocked = false;
unsigned long lastRfidEventMs = 0;
const unsigned long RFID_STATUS_HOLD_MS = 7000;
unsigned long lastRfidPollMs = 0;
unsigned long rfidGrantedCount = 0;
unsigned long rfidDeniedCount = 0;
unsigned long rfidUnknownCount = 0;
unsigned long rfidRevokedCount = 0;
unsigned long rfidRestrictedDeniedCount = 0;
unsigned long rfidVipServiceCount = 0;
bool priorityServiceActive = false;
int priorityFloor = -1;
char prioritySource[21] = "NONE";
unsigned long priorityUntilMs = 0;

// Physical calls awaiting RFID authorization (Objective 1 gate + WHO/WHERE
// pairing). pendingAuth[floor][type] remembers a hall/cabin press that had no
// covering session; it is shown as "SCAN CARD" and promoted to a real request
// once a valid card whose mask covers the floor is scanned, else it expires
// after RFID_PENDING_AUTH_WINDOW_MS. type indexes the RequestType enum
// (REQ_CABIN / REQ_HALL_UP / REQ_HALL_DOWN). lastPhysicalHall* records the most
// recent hall press so a VIP scan can prioritise the floor it is called FROM.
bool pendingAuth[NUM_FLOORS][3] = { { false } };
unsigned long pendingAuthUntilMs = 0;
int lastPhysicalHallFloor = -1;
unsigned long lastPhysicalHallMs = 0;

// =====================================================
// BUZZER / ALERT STATE
// =====================================================
// Plain integer constants avoid Arduino .ino prototype-generation problems
// with custom enum/struct types in function signatures.
const uint8_t BUZZ_PATTERN_NONE = 0;
const uint8_t BUZZ_PATTERN_STARTUP = 1;
const uint8_t BUZZ_PATTERN_BUTTON = 2;
const uint8_t BUZZ_PATTERN_QUEUED = 3;
const uint8_t BUZZ_PATTERN_ARRIVAL = 4;
const uint8_t BUZZ_PATTERN_DOOR = 5;
const uint8_t BUZZ_PATTERN_WARNING = 6;
const uint8_t BUZZ_PATTERN_WARNING_TEST = 7;
const uint8_t BUZZ_PATTERN_ERROR = 8;

const uint8_t BUZZ_PHASE_IDLE = 0;
const uint8_t BUZZ_PHASE_ON = 1;
const uint8_t BUZZ_PHASE_OFF = 2;
const uint8_t BUZZ_PHASE_REPEAT_GAP = 3;

uint8_t activeBuzzerPattern = BUZZ_PATTERN_NONE;
uint8_t buzzerPhase = BUZZ_PHASE_IDLE;
bool buzzerOutputActive = false;
uint8_t buzzerPulsesRemaining = 0;
unsigned long buzzerPhaseUntilMs = 0;
bool buzzerDiagnosticActive = false;
unsigned long buzzerDiagnosticUntilMs = 0;

bool warningAlertConfirmed = false;
unsigned long warningConditionSinceMs = 0;
bool adcSafetyFaultConfirmed = false;
unsigned long adcSafetyFaultSinceMs = 0;
const char* adcSafetyFaultReason = "NONE";


// =====================================================
// MQTT CLIENT STATE
// =====================================================
#if MQTT_USE_TLS
#include <WiFiClientSecure.h>
WiFiClientSecure espClient;  // TLS transport; CA pinned in setup()
#else
WiFiClient espClient;             // plaintext transport (fallback)
#endif
PubSubClient mqttClient(espClient);
unsigned long lastPublishMs = 0;
unsigned long lastMqttRetryMs = 0;
unsigned long lastMqttStatusMs = 0;
bool publishNow = false;

#if ENABLE_LCD
LiquidCrystal_I2C lcdConfigured(LCD_I2C_ADDRESS, LCD_COLS, LCD_ROWS);
LiquidCrystal_I2C lcdAddress27(0x27, LCD_COLS, LCD_ROWS);
LiquidCrystal_I2C lcdAddress3F(0x3F, LCD_COLS, LCD_ROWS);
LiquidCrystal_I2C* lcdDevice = nullptr;
#endif

bool lcdReady = false;
uint8_t lcdActiveAddress = LCD_I2C_ADDRESS;
unsigned long lastLcdUpdateMs = 0;
unsigned long lcdStartupUntilMs = 0;
unsigned long lcdTemporaryUntilMs = 0;
unsigned long lcdTestStepUntilMs = 0;
uint8_t lcdTestStep = 0;
bool lcdTestSequenceActive = false;
bool lcdForceRedraw = true;
char lcdRenderedLines[LCD_ROWS][LCD_COLS + 1];
char lcdTemporaryLines[LCD_ROWS][LCD_COLS + 1];



// =====================================================
// BUTTONS
// =====================================================
struct ButtonInput {
  const char* name;
  int pin;
  int floor;
  RequestType type;
  bool lastReading;
  bool stableState;
  unsigned long lastDebounce;
};

ButtonInput buttons[] = {
  { "OUT F0 UP", OUT_F0_UP_PIN, 0, REQ_HALL_UP, HIGH, HIGH, 0 },
  { "OUT F1 UP", OUT_F1_UP_PIN, 1, REQ_HALL_UP, HIGH, HIGH, 0 },
  { "OUT F1 DOWN", OUT_F1_DOWN_PIN, 1, REQ_HALL_DOWN, HIGH, HIGH, 0 },
  { "OUT F2 UP", OUT_F2_UP_PIN, 2, REQ_HALL_UP, HIGH, HIGH, 0 },
  { "OUT F2 DOWN", OUT_F2_DOWN_PIN, 2, REQ_HALL_DOWN, HIGH, HIGH, 0 },
  { "OUT F3 DOWN", OUT_F3_DOWN_PIN, 3, REQ_HALL_DOWN, HIGH, HIGH, 0 },
  { "CABIN F0", CABIN_F0_PIN, 0, REQ_CABIN, HIGH, HIGH, 0 },
  { "CABIN F1", CABIN_F1_PIN, 1, REQ_CABIN, HIGH, HIGH, 0 },
  { "CABIN F2", CABIN_F2_PIN, 2, REQ_CABIN, HIGH, HIGH, 0 },
  { "CABIN F3", CABIN_F3_PIN, 3, REQ_CABIN, HIGH, HIGH, 0 }
};
const int NUM_BUTTONS = sizeof(buttons) / sizeof(buttons[0]);


// =====================================================
// FORWARD DECLARATIONS
// =====================================================
const char* stateName(ElevatorState s);
void transitionTo(ElevatorState newState);
void enterErrorStop(const char* reason);
void enterEmergency(const char* reason);
void enterDoorOpening();
void enterMoving(int destination);
static bool redirectTrip(int newTargetFloor, const char* reason);
void handleFloorRequest(int floor, const char* source);
void handleRequest(int floor, RequestType type, const char* source);
void dispatchNextRequest();
void publishTelemetry();
void publishRequestQueueFeature(JsonObject value);
void handleDeviceDiagnosticCommand(const char* action, const char* source);
void publishMqttOnlineStatus(bool force);
#if PUBLISH_POSITION_WHILE_MOVING
void publishMovingPosition();
#endif
void setupSimulatedTelemetryAdc();
void updateSimulatedTelemetry();
void resetRuntimeState(const char* source);
void requestBuzzerPattern(uint8_t pattern);
void fanForceOutputHighDiagnostic();
void fanForceOutputLowDiagnostic();
void fanForceInputDiagnostic(bool pullup);
void setupLCD();
void updateLCD();
void lcdShowStartup();
void lcdShowNormal();
void lcdShowMoving();
void lcdShowDoor();
void lcdShowWarning();
void lcdShowError();
void lcdShowMessageTemporary(const char* line1, const char* line2, const char* line3, const char* line4, unsigned long durationMs);
void lcdClearLine(uint8_t row);
void formatLCDText(const char* input, char* output, size_t outputSize);
void lcdScanI2CBus();
void lcdScanSafeI2CPinPairs();
void printLcdConfiguration();
void runLcdScreenTest();
void recordRfidEvent(bool authorized, const char* role, const char* uid, const char* reason);
void setSecurityLockdown(bool locked, const char* source);
const char* rfidRoleName(RfidRole role);
bool rfidRoleCanUnlockLockdown(RfidRole role);
bool rfidSessionActive();
bool rfidFloorMaskAllows(uint8_t mask, int floor);
bool rfidRequestAllowed(int floor, RequestType type, const char* source);
void clearRfidSession(const char* reason);
void updateRfidSessionTimers();
int activePriorityStop();
void clearPriorityIfServed(int floor);
const RfidUser* findRfidUserByUid(const char* uid);
void formatCurrentRfidUid(char* output, size_t outputSize);
void setupRFID();
void serviceRFID();
void processRfidUid(const char* uid);
void printRfidStatus();
bool hasPendingAuth();
int firstPendingAuthFloor();
void clearPendingAuth(const char* reason);
void parkAuthRequest(int floor, RequestType type);
void promotePendingAuth(uint8_t mask);


// =====================================================
// CORE HELPERS
// =====================================================
const char* stateName(ElevatorState s) {
  switch (s) {
    case ST_IDLE: return "IDLE";
    case ST_DOOR_OPENING: return "DOOR_OPENING";
    case ST_DOOR_OPEN_WAIT: return "DOOR_OPEN_WAIT";
    case ST_DOOR_CLOSING: return "DOOR_CLOSING";
    case ST_MOVING_UP: return "MOVING_UP";
    case ST_MOVING_DOWN: return "MOVING_DOWN";
    case ST_ARRIVED: return "ARRIVED";
    case ST_ERROR_STOP: return "ERROR_STOP";
    case ST_EMERGENCY: return "EMERGENCY";
  }
  return "UNKNOWN";
}

// FSM transition legality (F1). A fault (ERROR_STOP / EMERGENCY) may be entered
// from ANY state; otherwise only the transitions enumerated below are expected.
// This is intentionally FAIL-OPEN: an unexpected transition is logged as
// [STATE][ILLEGAL] but still performed, so adding the guard cannot deadlock
// untested hardware. Once validated on the bench, set ALLOW_ILLEGAL_TRANSITIONS
// to 0 to make it fail-closed (reject the transition and trip ERROR_STOP).
#define ALLOW_ILLEGAL_TRANSITIONS 1

bool transitionAllowed(ElevatorState from, ElevatorState to) {
  if (to == ST_ERROR_STOP || to == ST_EMERGENCY) return true;  // fault from anywhere
  if (from == to) return true;

  switch (from) {
    case ST_IDLE: return to == ST_DOOR_OPENING || to == ST_MOVING_UP || to == ST_MOVING_DOWN;
    case ST_DOOR_OPENING: return to == ST_DOOR_OPEN_WAIT;
    case ST_DOOR_OPEN_WAIT: return to == ST_DOOR_CLOSING || to == ST_DOOR_OPENING;  // reopen
    case ST_DOOR_CLOSING: return to == ST_IDLE || to == ST_DOOR_OPENING;            // reopen
    case ST_MOVING_UP:
    case ST_MOVING_DOWN: return to == ST_ARRIVED;
    case ST_ARRIVED: return to == ST_DOOR_OPENING;
    case ST_ERROR_STOP:
    case ST_EMERGENCY: return to == ST_IDLE;  // recovery only
  }
  return false;
}

void transitionTo(ElevatorState newState) {
  if (newState == state) return;

  if (!transitionAllowed(state, newState)) {
    Serial.print("[STATE][ILLEGAL] ");
    Serial.print(stateName(state));
    Serial.print(" -> ");
    Serial.print(stateName(newState));
#if ALLOW_ILLEGAL_TRANSITIONS
    Serial.println(" (allowed anyway; review FSM)");
#else
    Serial.println(" (rejected)");
    enterErrorStop("Illegal FSM transition");
    return;
#endif
  }

  prevState = state;
  state = newState;
  stateEnteredMs = millis();
  publishNow = true;
  Serial.print("[STATE] ");
  Serial.print(stateName(prevState));
  Serial.print(" -> ");
  Serial.println(stateName(state));
}

bool doorIsConsideredClosed() {
  return state != ST_DOOR_OPENING && state != ST_DOOR_OPEN_WAIT && state != ST_DOOR_CLOSING;
}

bool inFaultState() {
  return state == ST_ERROR_STOP || state == ST_EMERGENCY;
}

bool isMovingState() {
  return state == ST_MOVING_UP || state == ST_MOVING_DOWN;
}

void copyBounded(char* destination, size_t destinationSize, const char* source) {
  if (!destination || destinationSize == 0) return;
  snprintf(destination, destinationSize, "%s", source ? source : "");
}

void setFaultReason(const char* reason) {
  copyBounded(lastFaultReason, sizeof(lastFaultReason), reason ? reason : "FAULT");
}

const char* rfidRoleName(RfidRole role) {
  switch (role) {
    case ROLE_UNAUTHORIZED: return "UNAUTH";
    case ROLE_RESTRICTED: return "RESTRICT";
    case ROLE_REGULAR: return "USER";
    case ROLE_VIP: return "VIP";
    case ROLE_ADMIN: return "ADMIN";
    case ROLE_MAINTENANCE: return "MAINT";
    case ROLE_SECURITY: return "SECURITY";
    case ROLE_UNKNOWN:
    default: return "UNKNOWN";
  }
}

bool rfidRoleCanUnlockLockdown(RfidRole role) {
  return role == ROLE_ADMIN || role == ROLE_SECURITY || role == ROLE_MAINTENANCE;
}

uint8_t rfidFloorBit(int floor) {
  if (!isValidFloor(floor)) return 0;
  return (uint8_t)(1U << floor);
}

bool rfidFloorMaskAllows(uint8_t mask, int floor) {
  uint8_t bit = rfidFloorBit(floor);
  return bit != 0 && ((mask & bit) != 0);
}

bool rfidSessionActive() {
  return activeRfidSessionUntilMs != 0 && millis() < activeRfidSessionUntilMs;
}

void clearRfidSession(const char* reason) {
  bool hadSession = activeRfidRole != ROLE_UNKNOWN || activeRfidSessionUntilMs != 0;
  activeRfidRole = ROLE_UNKNOWN;
  activeRfidFloorMask = 0;
  activeRfidSessionUntilMs = 0;
  copyBounded(activeRfidUid, sizeof(activeRfidUid), "----");
  copyBounded(activeRfidUserName, sizeof(activeRfidUserName), "NONE");
  copyBounded(activeRfidRoleName, sizeof(activeRfidRoleName), "NONE");
  lastRfidAuthorized = false;

  if (hadSession) {
    Serial.print("[RFID] session cleared");
    if (reason && reason[0]) {
      Serial.print(" (");
      Serial.print(reason);
      Serial.print(")");
    }
    Serial.println();
    publishNow = true;
  }
}

void updateRfidSessionTimers() {
  unsigned long now = millis();

  if (activeRfidSessionUntilMs != 0 && now >= activeRfidSessionUntilMs) {
    clearRfidSession("expired");
  }

  if (pendingAuthUntilMs != 0 && now >= pendingAuthUntilMs) {
    clearPendingAuth("auth window expired");
  }

  if (priorityServiceActive && now >= priorityUntilMs) {
    Serial.println("[RFID][PRIORITY] window expired");
    priorityServiceActive = false;
    priorityFloor = -1;
    copyBounded(prioritySource, sizeof(prioritySource), "NONE");
    publishNow = true;
  }

  if (!securityLocked
      && lastRfidEventMs != 0
      && (now - lastRfidEventMs > RFID_STATUS_HOLD_MS)
      && !rfidSessionActive()) {
    rfidDisplayState = RFID_NO_CARD;
  }
}

int activePriorityStop() {
  if (!priorityServiceActive) return -1;
  if (millis() >= priorityUntilMs) {
    updateRfidSessionTimers();
    return -1;
  }
  if (isValidFloor(priorityFloor) && hasRequestAtFloor(priorityFloor)) return priorityFloor;
  return -1;
}

void clearPriorityIfServed(int floor) {
  if (!priorityServiceActive || floor != priorityFloor) return;
  Serial.print("[RFID][PRIORITY] served floor ");
  Serial.println(floor);
  priorityServiceActive = false;
  priorityFloor = -1;
  copyBounded(prioritySource, sizeof(prioritySource), "NONE");
  publishNow = true;
}

const char* rfidStateLabel() {
  if (securityLocked || rfidDisplayState == RFID_LOCKED) return "LOCKED";
  switch (rfidDisplayState) {
    case RFID_AUTH: return "AUTH";
    case RFID_DENIED: return "DENIED";
    case RFID_ADMIN: return "ADMIN";
    case RFID_USER: return "USER";
    case RFID_MAINT: return "MAINT";
    case RFID_VIP: return "VIP";
    case RFID_SECURITY: return "SECURITY";
    case RFID_RESTRICTED: return "RESTRICTED";
    case RFID_LOCKED: return "LOCKED";
    case RFID_NO_CARD:
    default: return "NO CARD";
  }
}

const char* rfidShortLabel() {
  if (securityLocked || rfidDisplayState == RFID_LOCKED) return "LOCK";
  if (lastRfidEventMs == 0 || millis() - lastRfidEventMs > RFID_STATUS_HOLD_MS) return "NO";
  switch (rfidDisplayState) {
    case RFID_AUTH: return "AUTH";
    case RFID_DENIED: return "DEN";
    case RFID_ADMIN: return "ADM";
    case RFID_USER: return "USER";
    case RFID_MAINT: return "MAINT";
    case RFID_VIP: return "VIP";
    case RFID_SECURITY: return "SEC";
    case RFID_RESTRICTED: return "REST";
    case RFID_LOCKED: return "LOCK";
    case RFID_NO_CARD:
    default: return "NO";
  }
}

void recordRfidEvent(bool authorized, const char* role, const char* uid, const char* reason) {
  const char* cleanRole = (role && role[0] != '\0') ? role : (authorized ? "USER" : "UNKNOWN");
  const char* cleanReason = (reason && reason[0] != '\0') ? reason : (authorized ? "AUTHORIZED" : "UNKNOWN CARD");

  copyBounded(lastRfidUid, sizeof(lastRfidUid), (uid && uid[0] != '\0') ? uid : "----");
  copyBounded(lastRfidRole, sizeof(lastRfidRole), cleanRole);
  copyBounded(lastRfidReason, sizeof(lastRfidReason), cleanReason);
  lastRfidAuthorized = authorized;
  lastRfidEventMs = millis();

  if (securityLocked) {
    rfidDisplayState = RFID_LOCKED;
  } else if (!authorized) {
    rfidDisplayState = RFID_DENIED;
  } else if (!strcmp(cleanRole, "ADMIN")) {
    rfidDisplayState = RFID_ADMIN;
  } else if (!strcmp(cleanRole, "MAINT")) {
    rfidDisplayState = RFID_MAINT;
  } else if (!strcmp(cleanRole, "VIP")) {
    rfidDisplayState = RFID_VIP;
  } else if (!strcmp(cleanRole, "SECURITY")) {
    rfidDisplayState = RFID_SECURITY;
  } else if (!strcmp(cleanRole, "RESTRICT")) {
    rfidDisplayState = RFID_RESTRICTED;
  } else if (!strcmp(cleanRole, "USER")) {
    rfidDisplayState = RFID_USER;
  } else {
    rfidDisplayState = RFID_AUTH;
  }

  publishNow = true;

  char roleLine[LCD_COLS + 1];
  char uidLine[LCD_COLS + 1];
  snprintf(roleLine, sizeof(roleLine), "Role:%s", lastRfidRole);
  snprintf(uidLine, sizeof(uidLine), "UID:%s", lastRfidUid);

  if (authorized && !securityLocked) {
    requestBuzzerPattern(BUZZ_PATTERN_BUTTON);
    lcdShowMessageTemporary("ACCESS GRANTED", roleLine, uidLine,
                            priorityServiceActive ? "Priority active" : "Session active",
                            LCD_TEMP_MESSAGE_DURATION_MS);
  } else {
    requestBuzzerPattern(BUZZ_PATTERN_WARNING_TEST);
    lcdShowMessageTemporary("ACCESS DENIED", lastRfidReason, uidLine, "Check card", LCD_TEMP_MESSAGE_DURATION_MS);
  }

  Serial.print("[RFID] ");
  Serial.print(authorized && !securityLocked ? "ACCESS GRANTED" : "ACCESS DENIED");
  Serial.print(" role=");
  Serial.print(lastRfidRole);
  Serial.print(" uid=");
  Serial.print(lastRfidUid);
  Serial.print(" reason=");
  Serial.println(lastRfidReason);
}

const RfidUser* findRfidUserByUid(const char* uid) {
  if (!uid || uid[0] == '\0') return nullptr;
  for (size_t i = 0; i < RFID_USER_COUNT; i++) {
    if (!strcmp(uid, RFID_USERS[i].uid)) return &RFID_USERS[i];
  }
  return nullptr;
}

void formatCurrentRfidUid(char* output, size_t outputSize) {
  if (!output || outputSize == 0) return;
  output[0] = '\0';
#if ENABLE_RFID
  size_t pos = 0;
  for (byte i = 0; i < rfidReader.uid.size && pos + 2 < outputSize; i++) {
    pos += snprintf(output + pos, outputSize - pos, "%02X", rfidReader.uid.uidByte[i]);
  }
#else
  snprintf(output, outputSize, "DISABLED");
#endif
}

void setupRFID() {
#if ENABLE_RFID
  Serial.println("[RFID] configuring RC522 reader");
  pinMode(RFID_SS_PIN, OUTPUT);
  digitalWrite(RFID_SS_PIN, HIGH);
  SPI.begin(RFID_SCK_PIN, RFID_MISO_PIN, RFID_MOSI_PIN, RFID_SS_PIN);
  rfidReader.PCD_Init();
  delay(50);

  byte version = rfidReader.PCD_ReadRegister(MFRC522::VersionReg);
  rfidReady = version != 0x00 && version != 0xFF;
  rfidModuleFault = !rfidReady;

  Serial.print("[RFID] SS/RST/SCK/MISO/MOSI GPIO: ");
  Serial.print(RFID_SS_PIN);
  Serial.print("/");
  Serial.print(RFID_RST_PIN);
  Serial.print("/");
  Serial.print(RFID_SCK_PIN);
  Serial.print("/");
  Serial.print(RFID_MISO_PIN);
  Serial.print("/");
  Serial.println(RFID_MOSI_PIN);
  Serial.print("[RFID] reader version: 0x");
  Serial.println(version, HEX);
  Serial.print("[RFID] status: ");
  Serial.println(rfidReady ? "READY" : "UNAVAILABLE - access policy degraded open");
  Serial.print("[RFID] configured users: ");
  Serial.println((unsigned int)RFID_USER_COUNT);
#else
  rfidReady = false;
  rfidModuleFault = false;
  Serial.println("[RFID] disabled at compile time");
#endif
}

// ---- Physical-call authorization gate + WHO/WHERE pairing (Objective 1) ----
bool hasPendingAuth() {
  for (int f = 0; f < NUM_FLOORS; f++)
    for (int t = 0; t < 3; t++)
      if (pendingAuth[f][t]) return true;
  return false;
}

int firstPendingAuthFloor() {
  for (int f = 0; f < NUM_FLOORS; f++)
    for (int t = 0; t < 3; t++)
      if (pendingAuth[f][t]) return f;
  return -1;
}

void clearPendingAuth(const char* reason) {
  if (!hasPendingAuth()) {
    pendingAuthUntilMs = 0;
    return;
  }
  for (int f = 0; f < NUM_FLOORS; f++)
    for (int t = 0; t < 3; t++) pendingAuth[f][t] = false;
  pendingAuthUntilMs = 0;
  Serial.print("[RFID][AUTH] pending calls cleared");
  if (reason && reason[0]) {
    Serial.print(" (");
    Serial.print(reason);
    Serial.print(")");
  }
  Serial.println();
  publishNow = true;
}

// Remember a physical hall/cabin press that cannot dispatch yet because no
// authorized session covers the floor. Shown as "SCAN CARD" until a valid scan.
void parkAuthRequest(int floor, RequestType type) {
  if (!isValidFloor(floor)) return;
  pendingAuth[floor][(int)type] = true;
  pendingAuthUntilMs = millis() + RFID_PENDING_AUTH_WINDOW_MS;
  publishNow = true;
}

// After a valid scan, promote every parked call the card's mask covers into a
// real request via the normal path (WHO from the card, WHERE from the press).
void promotePendingAuth(uint8_t mask) {
  if (!hasPendingAuth()) return;
  const RequestType types[3] = { REQ_CABIN, REQ_HALL_UP, REQ_HALL_DOWN };
  for (int f = 0; f < NUM_FLOORS; f++) {
    for (int t = 0; t < 3; t++) {
      if (!pendingAuth[f][t]) continue;
      if (rfidFloorMaskAllows(mask, f)) {
        pendingAuth[f][t] = false;
        Serial.print("[RFID][AUTH] authorized parked floor ");
        Serial.print(f);
        Serial.print(" (");
        Serial.print(requestTypeName(types[t]));
        Serial.println(")");
        handleRequest(f, types[t], "RFID AUTH");
      }
    }
  }
  if (!hasPendingAuth()) pendingAuthUntilMs = 0;
  publishNow = true;
}

void processRfidUid(const char* uid) {
  const char* cleanUid = (uid && uid[0]) ? uid : "----";
  const RfidUser* user = findRfidUserByUid(cleanUid);

  if (!user) {
    rfidDeniedCount++;
    rfidUnknownCount++;
    recordRfidEvent(false, "UNKNOWN", cleanUid, "UNKNOWN CARD");
    return;
  }

  const char* roleName = rfidRoleName(user->role);

  if (user->revoked) {
    rfidDeniedCount++;
    rfidRevokedCount++;
    recordRfidEvent(false, roleName, cleanUid, "REVOKED CARD");
    return;
  }

  if (user->role == ROLE_UNAUTHORIZED || user->floorMask == 0) {
    rfidDeniedCount++;
    recordRfidEvent(false, roleName, cleanUid, "NO FLOOR RIGHTS");
    return;
  }

  if (securityLocked && (!rfidRoleCanUnlockLockdown(user->role) || !RFID_SECURITY_CARD_UNLOCKS_LOCKDOWN)) {
    rfidDeniedCount++;
    recordRfidEvent(false, roleName, cleanUid, "LOCKED");
    return;
  }

  if (securityLocked) {
    setSecurityLockdown(false, "RFID AUTHORIZED STAFF");
  }

  activeRfidRole = user->role;
  activeRfidFloorMask = user->floorMask;
  activeRfidSessionUntilMs = millis() + RFID_SESSION_MS;
  copyBounded(activeRfidUid, sizeof(activeRfidUid), cleanUid);
  copyBounded(activeRfidUserName, sizeof(activeRfidUserName), user->name);
  copyBounded(activeRfidRoleName, sizeof(activeRfidRoleName), roleName);

  if (user->priority) {
    // VIP faster-response: prioritise the floor the user is calling FROM -- the
    // recent paired hall press (WHERE). The card never targets a floor on its
    // own, so if there is no recent hall call there is nothing to prioritise yet.
    int vipFloor = -1;
    if (isValidFloor(lastPhysicalHallFloor)
        && (millis() - lastPhysicalHallMs) <= RFID_PENDING_AUTH_WINDOW_MS
        && rfidFloorMaskAllows(user->floorMask, lastPhysicalHallFloor)) {
      vipFloor = lastPhysicalHallFloor;
    }
    if (isValidFloor(vipFloor)) {
      priorityServiceActive = true;
      priorityFloor = vipFloor;
      priorityUntilMs = millis() + RFID_PRIORITY_WINDOW_MS;
      copyBounded(prioritySource, sizeof(prioritySource), roleName);
      if (user->role == ROLE_VIP) rfidVipServiceCount++;
      Serial.print("[RFID][PRIORITY] ");
      Serial.print(user->name);
      Serial.print(" priority floor ");
      Serial.print(priorityFloor);
      Serial.print(" window=");
      Serial.print(RFID_PRIORITY_WINDOW_MS / 1000);
      Serial.println("s");
    }
  }

  rfidGrantedCount++;
  recordRfidEvent(true, roleName, cleanUid, user->priority ? "PRIORITY AUTH" : "AUTHORIZED");

  // Release any hall/cabin presses parked waiting for this authorization.
  promotePendingAuth(user->floorMask);

  // A scan only AUTHORIZES: it opens a session and releases parked calls. It must
  // NOT inject a destination. The floor always comes from the buttons -- an
  // outside hall press summons the car to the caller, and in-cabin buttons pick
  // the destination. (Earlier firmware auto-requested the card's preferredFloor
  // here, which made a bare scan open the door or send the car to floor 0.)
}

void serviceRFID() {
  updateRfidSessionTimers();

#if ENABLE_RFID
  if (!rfidReady) return;

  // Objective 2 (stepper-lag fix): PICC_IsNewCardPresent() is a BLOCKING SPI
  // transaction (~1-3 ms when no tag answers). Because tickMoving() emits exactly
  // one step pulse per loop() iteration, polling the RC522 mid-trip injects a
  // periodic hitch straight into the step stream -> audible lag and reduced
  // average speed. Nobody badges to ride a car that is already moving, so suspend
  // polling while MOVING and resume the instant the cabin stops. Session/pending
  // timers above still run every loop so expiry stays accurate.
  if (isMovingState()) return;

  unsigned long now = millis();
  if (now - lastRfidPollMs < RFID_POLL_INTERVAL_MS) return;
  lastRfidPollMs = now;

  if (!rfidReader.PICC_IsNewCardPresent()) return;
  if (!rfidReader.PICC_ReadCardSerial()) return;

  char uid[25];
  formatCurrentRfidUid(uid, sizeof(uid));
  if (uid[0] != '\0') processRfidUid(uid);

  rfidReader.PICC_HaltA();
  rfidReader.PCD_StopCrypto1();
#endif
}

bool rfidRequestAllowed(int floor, RequestType type, const char* source) {
  (void)type;  // gating is decided by source panel
  if (!isValidFloor(floor)) return false;

  // Which physical panel issued this press? Trusted remote sources -- the
  // MQTT/SCADA operator, the serial console, and the RFID handler's own
  // authorized auto-request ("RFID...") -- are NEVER card-gated for ordinary
  // floors, so the dashboard and dispatch engine keep working. Restricted floors
  // stay gated for every source. The single reader + the hall button that was
  // pressed are the WHO + WHERE: gating the physical hall panel is what makes a
  // card required even to summon the car.
  bool physicalCabin = (source && strncmp(source, "CABIN", 5) == 0);
  bool physicalHall = (source && strncmp(source, "OUT", 3) == 0);

  if (!rfidReady) {
    if (!rfidDegradedNoticePrinted) {
      Serial.print("[RFID] reader unavailable: physical-call authorization degraded ");
      Serial.println(RFID_CABIN_DEGRADE_OPEN ? "OPEN (calls allowed)" : "CLOSED (calls blocked)");
      rfidDegradedNoticePrinted = true;
    }
    // Physical presses honour the degrade policy; remote sources always pass.
    return (physicalCabin || physicalHall) ? RFID_CABIN_DEGRADE_OPEN : true;
  }

  bool restrictedFloor = (RFID_RESTRICTED_FLOOR_MASK & rfidFloorBit(floor)) != 0;
  bool sessionActive = rfidSessionActive();

  // A card is required if the gate is on for the panel that issued this press,
  // or the target is a restricted floor (which applies to every source).
  bool authRequired = (physicalCabin && RFID_REQUIRE_AUTH_FOR_CABIN_CALLS) || (physicalHall && RFID_REQUIRE_AUTH_FOR_HALL_CALLS) || restrictedFloor;
  if (!authRequired) return true;

  if (!sessionActive) {
    rfidDeniedCount++;
    rfidRestrictedDeniedCount++;
    Serial.print("[REQ][RFID] floor ");
    Serial.print(floor);
    Serial.print(" denied: card required from ");
    Serial.println(source ? source : "UNKNOWN");
    recordRfidEvent(false, "NO CARD", "----", restrictedFloor ? "CARD REQUIRED" : "AUTH REQUIRED");
    return false;
  }

  if (!rfidFloorMaskAllows(activeRfidFloorMask, floor)) {
    rfidDeniedCount++;
    rfidRestrictedDeniedCount++;
    Serial.print("[REQ][RFID] floor ");
    Serial.print(floor);
    Serial.print(" denied for ");
    Serial.print(activeRfidRoleName);
    Serial.print(" uid=");
    Serial.println(activeRfidUid);
    recordRfidEvent(false, activeRfidRoleName, activeRfidUid, "FLOOR DENIED");
    return false;
  }

  return true;
}

void printRfidStatus() {
  Serial.println("[RFID][STATUS]");
  Serial.print("  reader=");
  Serial.print(rfidReady ? "READY" : (ENABLE_RFID ? "UNAVAILABLE" : "DISABLED"));
  Serial.print(" fault=");
  Serial.println(rfidModuleFault ? "YES" : "NO");
  Serial.print("  last uid=");
  Serial.print(lastRfidUid);
  Serial.print(" role=");
  Serial.print(lastRfidRole);
  Serial.print(" authorized=");
  Serial.println(lastRfidAuthorized ? "YES" : "NO");
  Serial.print("  active session=");
  Serial.print(rfidSessionActive() ? "YES" : "NO");
  Serial.print(" user=");
  Serial.print(activeRfidUserName);
  Serial.print(" role=");
  Serial.print(activeRfidRoleName);
  Serial.print(" expires_ms=");
  Serial.println(activeRfidSessionUntilMs);
  Serial.print("  priority=");
  Serial.print(priorityServiceActive ? "YES" : "NO");
  Serial.print(" floor=");
  Serial.print(priorityFloor);
  Serial.print(" source=");
  Serial.println(prioritySource);
  Serial.print("  grants/denies/unknown/revoked/floor_denied/vip=");
  Serial.print(rfidGrantedCount);
  Serial.print("/");
  Serial.print(rfidDeniedCount);
  Serial.print("/");
  Serial.print(rfidUnknownCount);
  Serial.print("/");
  Serial.print(rfidRevokedCount);
  Serial.print("/");
  Serial.print(rfidRestrictedDeniedCount);
  Serial.print("/");
  Serial.println(rfidVipServiceCount);
  Serial.println("  Update RFID_USERS[] with real card UIDs printed above.");
}

// Security lockdown enforcement (F3). Previously `securityLocked` was declared
// but only ever set false, so the "secure" elevator had no enforced security
// state. When locked, new floor requests are refused and the dispatcher will
// not start a trip. An in-flight trip is intentionally allowed to finish: a
// security event must not command an abrupt mid-shaft stop (that is what the
// EMERGENCY path is for). The agentic/automation layer drives this via MQTT
// SECURITY_LOCK / SECURITY_UNLOCK; a real RFID handler may also call it after
// evaluating a card.
void setSecurityLockdown(bool locked, const char* source) {
  if (securityLocked == locked) return;
  securityLocked = locked;
  if (locked) {
    rfidDisplayState = RFID_LOCKED;
    clearRfidSession("lockdown");
    clearPendingAuth("lockdown");
    priorityServiceActive = false;
    priorityFloor = -1;
    copyBounded(prioritySource, sizeof(prioritySource), "NONE");
    priorityUntilMs = 0;
    requestBuzzerPattern(BUZZ_PATTERN_WARNING_TEST);
    lcdShowMessageTemporary("SECURITY LOCK", "Access disabled",
                            (source && source[0]) ? source : "Locked",
                            "Calls blocked", LCD_TEMP_MESSAGE_DURATION_MS);
  } else {
    rfidDisplayState = RFID_NO_CARD;
    lcdShowMessageTemporary("SECURITY OPEN", "Access enabled",
                            (source && source[0]) ? source : "Unlocked",
                            "System ready", LCD_TEMP_MESSAGE_DURATION_MS);
  }
  publishNow = true;
  Serial.print("[SECURITY] lockdown ");
  Serial.print(locked ? "ENGAGED" : "released");
  if (source && source[0]) {
    Serial.print(" (");
    Serial.print(source);
    Serial.print(")");
  }
  Serial.println();
}


// =====================================================
// FAN RELAY
//
// JQC3F-05VDC-C wiring defaults: ON = OUTPUT LOW, OFF = INPUT/high-Z.
// fanHardwareOn/Off are the ONLY functions that touch the GPIO. setFanState
// wraps it so the twin-published flags + runtime counters stay coherent.
// =====================================================
void fanHardwareOn() {
  pinMode(FAN_RELAY_PIN, OUTPUT);
  digitalWrite(FAN_RELAY_PIN, FAN_RELAY_ACTIVE_LOW ? LOW : HIGH);
  fanHardwareRequestedOn = true;
}

void fanHardwareOff() {
  pinMode(FAN_RELAY_PIN, INPUT);
  fanHardwareRequestedOn = false;
}

void fanForceOutputHighDiagnostic() {
  fanMode = FAN_MODE_MANUAL;
  fanManualState = false;
  fanIsOn = false;
  fanReason = "DIAG_OUTPUT_HIGH";
  pinMode(FAN_RELAY_PIN, OUTPUT);
  digitalWrite(FAN_RELAY_PIN, HIGH);
  fanHardwareRequestedOn = false;
  publishNow = true;
  Serial.print("[FAN][DIAG] GPIO");
  Serial.print(FAN_RELAY_PIN);
  Serial.println(" forced OUTPUT HIGH");
}

void fanForceOutputLowDiagnostic() {
  fanMode = FAN_MODE_MANUAL;
  fanManualState = true;
  fanIsOn = true;
  fanReason = "DIAG_OUTPUT_LOW";
  pinMode(FAN_RELAY_PIN, OUTPUT);
  digitalWrite(FAN_RELAY_PIN, LOW);
  fanHardwareRequestedOn = true;
  publishNow = true;
  Serial.print("[FAN][DIAG] GPIO");
  Serial.print(FAN_RELAY_PIN);
  Serial.println(" forced OUTPUT LOW");
}

void fanForceInputDiagnostic(bool pullup) {
  fanMode = FAN_MODE_MANUAL;
  fanManualState = false;
  fanIsOn = false;
  fanReason = pullup ? "DIAG_INPUT_PULLUP" : "DIAG_INPUT";
  pinMode(FAN_RELAY_PIN, pullup ? INPUT_PULLUP : INPUT);
  fanHardwareRequestedOn = false;
  publishNow = true;
  Serial.print("[FAN][DIAG] GPIO");
  Serial.print(FAN_RELAY_PIN);
  Serial.println(pullup ? " forced INPUT_PULLUP" : " forced INPUT/high-Z");
}

void fanSetRelay(bool turnOn) {
  if (turnOn) {
    fanHardwareOn();
  } else {
    fanHardwareOff();
  }
}

void setFanState(bool turnOn, const char* reason) {
  unsigned long now = millis();
  if (turnOn && !fanIsOn) {
    fanLastOnMs = now;
    publishNow = true;
  } else if (!turnOn && fanIsOn) {
    fanRuntimeMsToday += now - fanLastOnMs;
    publishNow = true;
  }
  fanIsOn = turnOn;
  fanReason = reason ? reason : (turnOn ? "ON" : "IDLE");
  fanSetRelay(turnOn);
}

void markFanActivity() {
  lastFanActivityMs = millis();
}

unsigned long fanRuntimeMs() {
  unsigned long total = fanRuntimeMsToday;
  if (fanIsOn) total += millis() - fanLastOnMs;
  return total;
}

// Cooling decision tree. Movement alone must not start the fan; thermal
// conditions still override and can run the fan while the cabin is moving.
void updateFanAuto() {
  unsigned long now = millis();

  if (fanMode == FAN_MODE_MANUAL) {
    if (simulatedTemperatureC >= FAN_CRITICAL_MOTOR_TEMP_C) {
      setFanState(true, "MOTOR_CRITICAL_TEMP");
      return;
    }
    if (fanIsOn != fanManualState || fanHardwareRequestedOn != fanManualState) {
      setFanState(fanManualState, "OPERATOR_OVERRIDE");
    }
    return;
  }

  if (lastHotRunEndedMs != 0 && now - lastHotRunEndedMs < FAN_HOT_COOLDOWN_MS) {
    setFanState(true, "POST_RUN_PURGE");
    return;
  }
  if (lastHotRunEndedMs != 0 && now - lastHotRunEndedMs >= FAN_HOT_COOLDOWN_MS) {
    lastHotRunEndedMs = 0;
  }

  if (lastFanActivityMs != 0 && now - lastFanActivityMs <= FAN_AFTER_RUN_MS) {
    setFanState(true, "POST_ACTIVITY");
    return;
  }

  if (simulatedTemperatureC >= FAN_CRITICAL_MOTOR_TEMP_C) {
    setFanState(true, "MOTOR_CRITICAL_TEMP");
    return;
  }
  if (simulatedTemperatureC >= FAN_MOTOR_ON_TEMP_C) {
    setFanState(true, "MOTOR_TEMP_HIGH");
    return;
  }
  if (simulatedCabinTemperatureC >= FAN_CABIN_ON_TEMP_C) {
    setFanState(true, "CABIN_TEMP_HIGH");
    return;
  }
  if (fanIsOn && simulatedTemperatureC > FAN_MOTOR_OFF_TEMP_C) {
    setFanState(true, "HYSTERESIS_HOLD");
    return;
  }

  setFanState(false, "IDLE");
}

// =====================================================
// ANALOG SIMULATION TELEMETRY
// =====================================================
int readAveragedAdcRaw(int pin, uint8_t samples) {
  if (samples < 1) samples = 1;
  uint32_t sum = 0;
  for (uint8_t i = 0; i < samples; i++) {
    sum += analogRead(pin);
  }
  return (int)(sum / samples);
}

int readAveragedAdcRaw(int pin) {
  return readAveragedAdcRaw(pin, SIM_ADC_AVG_SAMPLES);
}

float mapAdcRawToRange(int raw, float outMin, float outMax) {
  int bounded = constrain(raw, 0, SIM_ADC_MAX_RAW);
  float ratio = (float)bounded / (float)SIM_ADC_MAX_RAW;
  return outMin + ratio * (outMax - outMin);
}

float smoothSimValue(float previous, float next) {
  float alpha = (next < previous) ? SIM_ADC_RECOVERY_ALPHA : SIM_ADC_RISE_ALPHA;
  return previous + alpha * (next - previous);
}

float estimateCabinTemperatureC(float motorTempC, float loadKg) {
  float loadRatio = constrain(loadKg / SIM_LOAD_RATED_KG, 0.0f, 1.25f);
  float motorContribution = max(0.0f, motorTempC - 35.0f) * SIM_CABIN_TEMP_MOTOR_GAIN;
  return SIM_CABIN_TEMP_BASE_C + loadRatio * SIM_CABIN_TEMP_LOAD_GAIN_C + motorContribution;
}

void printSimulatedTelemetry() {
  Serial.print("[ADC] TEMP: raw=");
  Serial.print(simTempRaw);
  Serial.print(", value=");
  Serial.print(simulatedTemperatureC, 1);
  Serial.print("C | VIB: raw=");
  Serial.print(simVibRaw);
  Serial.print(", value=");
  Serial.print(simulatedVibrationG, 3);
  Serial.print("g | LOAD: raw=");
  Serial.print(simLoadRaw);
  Serial.print(", value=");
  Serial.print(simulatedLoadKg, 0);
  Serial.print("kg | CABIN: value=");
  Serial.print(simulatedCabinTemperatureC, 1);
  Serial.println("C");

  if (simulatedTemperatureC >= SIM_TEMP_CRITICAL_C) {
    Serial.println("[ADC][WARN] motor temperature CRITICAL threshold reached");
  } else if (simulatedTemperatureC >= SIM_TEMP_WARNING_C) {
    Serial.println("[ADC][WARN] motor temperature high");
  }

  if (simulatedVibrationG >= SIM_VIB_CRITICAL_G) {
    Serial.println("[ADC][WARN] motor vibration CRITICAL threshold reached");
  } else if (simulatedVibrationG >= SIM_VIB_WARNING_G) {
    Serial.println("[ADC][WARN] motor vibration high");
  }

  if (simulatedLoadKg >= SIM_LOAD_RATED_KG) {
    Serial.println("[ADC][WARN] cabin load at/above rated load");
  }
}

void setupSimulatedTelemetryAdc() {
  if (!SIM_ADC_ENABLED) return;

  analogReadResolution(SIM_ADC_RESOLUTION_BITS);
  analogSetPinAttenuation(SIM_TEMP_ADC_PIN, ADC_11db);
  analogSetPinAttenuation(SIM_VIB_ADC_PIN, ADC_11db);
  analogSetPinAttenuation(SIM_LOAD_ADC_PIN, ADC_11db);
  pinMode(SIM_TEMP_ADC_PIN, INPUT);
  pinMode(SIM_VIB_ADC_PIN, INPUT);
  pinMode(SIM_LOAD_ADC_PIN, INPUT);

  simTempRaw = readAveragedAdcRaw(SIM_TEMP_ADC_PIN);
  simVibRaw = readAveragedAdcRaw(SIM_VIB_ADC_PIN);
  simLoadRaw = readAveragedAdcRaw(SIM_LOAD_ADC_PIN);
  simulatedTemperatureC = mapAdcRawToRange(simTempRaw, SIM_TEMP_MIN_C, SIM_TEMP_MAX_C);
  simulatedVibrationG = mapAdcRawToRange(simVibRaw, SIM_VIB_MIN_G, SIM_VIB_MAX_G);
  simulatedLoadKg = mapAdcRawToRange(simLoadRaw, SIM_LOAD_MIN_KG, SIM_LOAD_MAX_KG);
  simulatedCabinTemperatureC = estimateCabinTemperatureC(simulatedTemperatureC, simulatedLoadKg);
  simTelemetryInitialized = true;

  Serial.println("[ADC] simulation inputs enabled");
  Serial.print("[ADC] TEMP GPIO");
  Serial.print(SIM_TEMP_ADC_PIN);
  Serial.print(" range ");
  Serial.print(SIM_TEMP_MIN_C, 1);
  Serial.print("..");
  Serial.print(SIM_TEMP_MAX_C, 1);
  Serial.println(" C");
  Serial.print("[ADC] VIB  GPIO");
  Serial.print(SIM_VIB_ADC_PIN);
  Serial.print(" range ");
  Serial.print(SIM_VIB_MIN_G, 3);
  Serial.print("..");
  Serial.print(SIM_VIB_MAX_G, 3);
  Serial.println(" g");
  Serial.print("[ADC] LOAD GPIO");
  Serial.print(SIM_LOAD_ADC_PIN);
  Serial.print(" range ");
  Serial.print(SIM_LOAD_MIN_KG, 0);
  Serial.print("..");
  Serial.print(SIM_LOAD_MAX_KG, 0);
  Serial.println(" kg");
}

void updateSimulatedTelemetry() {
  if (!SIM_ADC_ENABLED) return;
  const bool moving = isMovingState();
  if (moving && !SIM_ADC_UPDATE_WHILE_MOVING) return;

  unsigned long now = millis();
  unsigned long updateInterval = moving ? SIM_ADC_MOVING_UPDATE_MS : SIM_ADC_UPDATE_MS;
  if (now - lastSimAdcUpdateMs < updateInterval) return;
  lastSimAdcUpdateMs = now;

  uint8_t samples = moving ? SIM_ADC_MOVING_AVG_SAMPLES : SIM_ADC_AVG_SAMPLES;
  simTempRaw = readAveragedAdcRaw(SIM_TEMP_ADC_PIN, samples);
  simVibRaw = readAveragedAdcRaw(SIM_VIB_ADC_PIN, samples);
  simLoadRaw = readAveragedAdcRaw(SIM_LOAD_ADC_PIN, samples);

  float nextTemp = mapAdcRawToRange(simTempRaw, SIM_TEMP_MIN_C, SIM_TEMP_MAX_C);
  float nextVib = mapAdcRawToRange(simVibRaw, SIM_VIB_MIN_G, SIM_VIB_MAX_G);
  float nextLoad = mapAdcRawToRange(simLoadRaw, SIM_LOAD_MIN_KG, SIM_LOAD_MAX_KG);

  if (!simTelemetryInitialized) {
    simulatedTemperatureC = nextTemp;
    simulatedVibrationG = nextVib;
    simulatedLoadKg = nextLoad;
    simulatedCabinTemperatureC = estimateCabinTemperatureC(nextTemp, nextLoad);
    simTelemetryInitialized = true;
  } else {
    simulatedTemperatureC = smoothSimValue(simulatedTemperatureC, nextTemp);
    simulatedVibrationG = smoothSimValue(simulatedVibrationG, nextVib);
    simulatedLoadKg = smoothSimValue(simulatedLoadKg, nextLoad);
    float nextCabinTemp = estimateCabinTemperatureC(simulatedTemperatureC, simulatedLoadKg);
    simulatedCabinTemperatureC = smoothSimValue(simulatedCabinTemperatureC, nextCabinTemp);
  }

  if (now - lastSimAdcPrintMs >= SIM_ADC_PRINT_MS) {
    lastSimAdcPrintMs = now;
    printSimulatedTelemetry();
  }
}


// =====================================================
// BUZZER ALERT SCHEDULER
// =====================================================
uint16_t buzzerPatternOnMs(uint8_t pattern) {
  switch (pattern) {
    case BUZZ_PATTERN_STARTUP: return 0;
    case BUZZ_PATTERN_BUTTON: return 35;
    case BUZZ_PATTERN_QUEUED: return 30;
    case BUZZ_PATTERN_ARRIVAL: return 70;
    case BUZZ_PATTERN_DOOR: return 30;
    case BUZZ_PATTERN_WARNING: return 55;
    case BUZZ_PATTERN_WARNING_TEST: return 55;
    case BUZZ_PATTERN_ERROR: return 70;
    default: return 0;
  }
}

uint16_t buzzerPatternOffMs(uint8_t pattern) {
  switch (pattern) {
    case BUZZ_PATTERN_STARTUP: return 0;
    case BUZZ_PATTERN_BUTTON: return 25;
    case BUZZ_PATTERN_QUEUED: return 40;
    case BUZZ_PATTERN_ARRIVAL: return 70;
    case BUZZ_PATTERN_DOOR: return 25;
    case BUZZ_PATTERN_WARNING: return 80;
    case BUZZ_PATTERN_WARNING_TEST: return 80;
    case BUZZ_PATTERN_ERROR: return 100;
    default: return 0;
  }
}

uint8_t buzzerPatternPulses(uint8_t pattern) {
  switch (pattern) {
    case BUZZ_PATTERN_STARTUP: return 0;
    case BUZZ_PATTERN_BUTTON: return 1;
    case BUZZ_PATTERN_QUEUED: return 2;
    case BUZZ_PATTERN_ARRIVAL: return 1;
    case BUZZ_PATTERN_DOOR: return 1;
    case BUZZ_PATTERN_WARNING: return 1;
    case BUZZ_PATTERN_WARNING_TEST: return 2;
    case BUZZ_PATTERN_ERROR: return 2;
    default: return 0;
  }
}

uint16_t buzzerPatternRepeatGapMs(uint8_t pattern) {
  switch (pattern) {
    case BUZZ_PATTERN_WARNING: return 5000;
    case BUZZ_PATTERN_ERROR: return 3000;
    default: return 0;
  }
}

bool buzzerPatternRepeats(uint8_t pattern) {
  return pattern == BUZZ_PATTERN_WARNING || pattern == BUZZ_PATTERN_ERROR;
}

uint8_t buzzerPatternPriority(uint8_t pattern) {
  switch (pattern) {
    case BUZZ_PATTERN_STARTUP: return 2;
    case BUZZ_PATTERN_BUTTON: return 2;
    case BUZZ_PATTERN_QUEUED: return 2;
    case BUZZ_PATTERN_ARRIVAL: return 3;
    case BUZZ_PATTERN_DOOR: return 2;
    case BUZZ_PATTERN_WARNING: return 4;
    case BUZZ_PATTERN_WARNING_TEST: return 4;
    case BUZZ_PATTERN_ERROR: return 10;
    default: return 0;
  }
}

void buzzerHardwareWrite(bool active) {
  if (!ENABLE_BUZZER) return;
  if (active) {
    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, BUZZER_ACTIVE_HIGH ? HIGH : LOW);
  } else if (BUZZER_OFF_USES_INPUT_PULLUP) {
    pinMode(BUZZER_PIN, INPUT_PULLUP);
  } else {
    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, BUZZER_ACTIVE_HIGH ? LOW : HIGH);
  }
  buzzerOutputActive = active;
}

void buzzerReleasePin() {
  if (!ENABLE_BUZZER) return;
  buzzerDiagnosticActive = false;
  activeBuzzerPattern = BUZZ_PATTERN_NONE;
  buzzerPhase = BUZZ_PHASE_IDLE;
  buzzerPulsesRemaining = 0;
  buzzerPhaseUntilMs = 0;
  buzzerOutputActive = false;
  pinMode(BUZZER_PIN, INPUT_PULLUP);
}

void buzzerOff() {
  buzzerHardwareWrite(false);
}

void buzzerOn() {
  buzzerHardwareWrite(true);
}

void setupBuzzer() {
  if (!ENABLE_BUZZER) return;
  buzzerOff();
  Serial.print("[BUZZER] enabled on GPIO");
  Serial.print(BUZZER_PIN);
  Serial.println(" as direct GPIO low-side sink");
}

void buzzerStop() {
  buzzerDiagnosticActive = false;
  buzzerOff();
  activeBuzzerPattern = BUZZ_PATTERN_NONE;
  buzzerPhase = BUZZ_PHASE_IDLE;
  buzzerPulsesRemaining = 0;
  buzzerPhaseUntilMs = 0;
}

void buzzerStartOnPhase(unsigned long now) {
  if (buzzerPatternPulses(activeBuzzerPattern) == 0 || buzzerPulsesRemaining == 0) {
    buzzerStop();
    return;
  }
  buzzerPulsesRemaining--;
  buzzerOn();
  buzzerPhase = BUZZ_PHASE_ON;
  buzzerPhaseUntilMs = now + buzzerPatternOnMs(activeBuzzerPattern);
}

void startBuzzerPattern(uint8_t pattern) {
  if (!ENABLE_BUZZER || pattern == BUZZ_PATTERN_NONE) return;
  activeBuzzerPattern = pattern;
  buzzerPulsesRemaining = buzzerPatternPulses(pattern);
  buzzerPhase = BUZZ_PHASE_IDLE;
  buzzerPhaseUntilMs = 0;
  buzzerStartOnPhase(millis());
}

void startBuzzerRawLevelTest(bool levelHigh) {
  if (!ENABLE_BUZZER) return;
  activeBuzzerPattern = BUZZ_PATTERN_NONE;
  buzzerPhase = BUZZ_PHASE_IDLE;
  buzzerPulsesRemaining = 0;
  buzzerPhaseUntilMs = 0;
  buzzerDiagnosticActive = true;
  buzzerDiagnosticUntilMs = millis() + BUZZER_DIAGNOSTIC_HOLD_MS;
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, levelHigh ? HIGH : LOW);
  buzzerOutputActive = (levelHigh == BUZZER_ACTIVE_HIGH);

  Serial.print("[BUZZER] raw GPIO");
  Serial.print(BUZZER_PIN);
  Serial.print(levelHigh ? " HIGH" : " LOW");
  Serial.print(" for ");
  Serial.print(BUZZER_DIAGNOSTIC_HOLD_MS);
  Serial.println(" ms");
}

void requestBuzzerPattern(uint8_t pattern) {
  if (!ENABLE_BUZZER || pattern == BUZZ_PATTERN_NONE) return;
  if (activeBuzzerPattern != BUZZ_PATTERN_NONE && buzzerPatternPriority(activeBuzzerPattern) > buzzerPatternPriority(pattern)) {
    return;
  }
  startBuzzerPattern(pattern);
}

bool warningConditionNow() {
  if (!ENABLE_WARNING_ALERTS) return false;
  return simulatedLoadKg >= SIM_LOAD_RATED_KG || simulatedTemperatureC >= SIM_TEMP_WARNING_C || simulatedVibrationG >= SIM_VIB_WARNING_G;
}

void updateWarningAlertState() {
  if (!ENABLE_WARNING_ALERTS) {
    warningAlertConfirmed = false;
    warningConditionSinceMs = 0;
    return;
  }

  unsigned long now = millis();
  if (!warningConditionNow()) {
    warningAlertConfirmed = false;
    warningConditionSinceMs = 0;
    return;
  }

  if (warningConditionSinceMs == 0) warningConditionSinceMs = now;
  if (now - warningConditionSinceMs >= WARNING_ALERT_CONFIRM_MS) {
    warningAlertConfirmed = true;
  }
}

const char* adcSafetyFaultNowReason() {
  if (!ENABLE_ADC_SAFETY_INTERLOCK) return nullptr;
  if (simulatedLoadKg >= SIM_LOAD_RATED_KG) return "CABIN_OVERLOAD";
  if (simulatedTemperatureC >= SIM_TEMP_CRITICAL_C) return "MOTOR_TEMP_CRITICAL";
  if (simulatedVibrationG >= SIM_VIB_CRITICAL_G) return "VIBRATION_CRITICAL";
  return nullptr;
}

const char* adcMovementLockoutNowReason() {
  if (!ENABLE_ADC_SAFETY_INTERLOCK) return nullptr;
  if (simulatedLoadKg >= SIM_LOAD_RATED_KG) return "CABIN_OVERLOAD";
  if (simulatedTemperatureC >= SIM_TEMP_WARNING_C) return "MOTOR_TEMP_HIGH";
  if (simulatedVibrationG >= SIM_VIB_WARNING_G) return "VIBRATION_HIGH";
  return nullptr;
}

bool adcSafetyMovementBlocked() {
  return adcMovementLockoutNowReason() != nullptr;
}

void printAdcSafetyFaultSnapshot(const char* reason) {
  Serial.print("[SAFETY] ");
  Serial.print(reason ? reason : "ADC_FAULT");
  Serial.print(" confirmed | temp=");
  Serial.print(simulatedTemperatureC, 1);
  Serial.print("C vib=");
  Serial.print(simulatedVibrationG, 3);
  Serial.print("g load=");
  Serial.print(simulatedLoadKg, 0);
  Serial.println("kg");
}

void updateAdcSafetyInterlock() {
  if (!ENABLE_ADC_SAFETY_INTERLOCK) {
    adcSafetyFaultConfirmed = false;
    adcSafetyFaultSinceMs = 0;
    adcSafetyFaultReason = "NONE";
    return;
  }

  const char* reason = adcSafetyFaultNowReason();
  if (!reason) {
    adcSafetyFaultConfirmed = false;
    adcSafetyFaultSinceMs = 0;
    adcSafetyFaultReason = "NONE";
    return;
  }

  unsigned long now = millis();
  if (adcSafetyFaultSinceMs == 0 || strcmp(reason, adcSafetyFaultReason) != 0) {
    adcSafetyFaultSinceMs = now;
    adcSafetyFaultReason = reason;
    adcSafetyFaultConfirmed = false;
    Serial.print("[SAFETY] ADC safety condition pending confirmation: ");
    Serial.println(reason);
    return;
  }

  if (!adcSafetyFaultConfirmed && now - adcSafetyFaultSinceMs >= ADC_SAFETY_FAULT_CONFIRM_MS) {
    adcSafetyFaultConfirmed = true;
    printAdcSafetyFaultSnapshot(reason);
    publishNow = true;
  }

  if (adcSafetyFaultConfirmed && !inFaultState()) {
    enterErrorStop(reason);
  }
}

void updateBuzzer() {
  if (!ENABLE_BUZZER) return;

  if (buzzerDiagnosticActive) {
    if (millis() >= buzzerDiagnosticUntilMs) {
      buzzerReleasePin();
      Serial.println("[BUZZER] raw GPIO test complete, pin released");
    }
    return;
  }

  if (inFaultState()) {
    if (activeBuzzerPattern != BUZZ_PATTERN_ERROR) startBuzzerPattern(BUZZ_PATTERN_ERROR);
  } else if (activeBuzzerPattern == BUZZ_PATTERN_ERROR) {
    buzzerStop();
  }

  if (!inFaultState() && warningAlertConfirmed) {
    if (activeBuzzerPattern != BUZZ_PATTERN_WARNING && buzzerPatternPriority(activeBuzzerPattern) <= buzzerPatternPriority(BUZZ_PATTERN_WARNING)) {
      startBuzzerPattern(BUZZ_PATTERN_WARNING);
    }
  } else if (activeBuzzerPattern == BUZZ_PATTERN_WARNING) {
    buzzerStop();
  }

  if (activeBuzzerPattern == BUZZ_PATTERN_NONE) return;

  unsigned long now = millis();
  if (now < buzzerPhaseUntilMs) return;

  if (buzzerPhase == BUZZ_PHASE_ON) {
    buzzerOff();
    if (buzzerPulsesRemaining > 0) {
      buzzerPhase = BUZZ_PHASE_OFF;
      buzzerPhaseUntilMs = now + buzzerPatternOffMs(activeBuzzerPattern);
    } else if (buzzerPatternRepeats(activeBuzzerPattern)) {
      buzzerPhase = BUZZ_PHASE_REPEAT_GAP;
      buzzerPhaseUntilMs = now + buzzerPatternRepeatGapMs(activeBuzzerPattern);
    } else {
      buzzerStop();
    }
    return;
  }

  if (buzzerPhase == BUZZ_PHASE_OFF) {
    buzzerStartOnPhase(now);
    return;
  }

  if (buzzerPhase == BUZZ_PHASE_REPEAT_GAP) {
    buzzerPulsesRemaining = buzzerPatternPulses(activeBuzzerPattern);
    buzzerStartOnPhase(now);
  }
}


// =====================================================
// STEPPER
// =====================================================
void setDirectionUp() {
  if (DIR_UP_ACTIVE_LOW) {
    pinMode(DIR_PIN, OUTPUT);
    digitalWrite(DIR_PIN, LOW);
  } else {
    pinMode(DIR_PIN, INPUT);
  }
}

void setDirectionDown() {
  if (DIR_UP_ACTIVE_LOW) {
    pinMode(DIR_PIN, INPUT);
  } else {
    pinMode(DIR_PIN, OUTPUT);
    digitalWrite(DIR_PIN, LOW);
  }
}

void stepOnce(int delayUs) {
  pinMode(STEP_PIN, OUTPUT);
  digitalWrite(STEP_PIN, LOW);
  delayMicroseconds(STEP_PULSE_WIDTH_US);
  pinMode(STEP_PIN, INPUT);
  delayMicroseconds(delayUs);
}

void stopStepper() {
  pinMode(STEP_PIN, INPUT);
}

// V6: ramp anchored to step count, not wall-clock time.
int currentStepDelayUs() {
  unsigned long delivered = stepsDelivered;
  unsigned long remaining = (delivered >= stepsToDeliver) ? 0 : (stepsToDeliver - delivered);

  if (delivered < STEP_ACCEL_STEPS) {
    float k = (float)delivered / (float)STEP_ACCEL_STEPS;
    return STEP_DELAY_SLOW_US + (int)((STEP_DELAY_FAST_US - STEP_DELAY_SLOW_US) * k);
  }
  if (remaining < STEP_DECEL_STEPS) {
    float k = (float)remaining / (float)STEP_DECEL_STEPS;
    return STEP_DELAY_SLOW_US + (int)((STEP_DELAY_FAST_US - STEP_DELAY_SLOW_US) * k);
  }
  return STEP_DELAY_FAST_US;
}


// =====================================================
// DOOR MOTOR
// =====================================================
void doorStop() {
  digitalWrite(DOOR_IN1_PIN, LOW);
  digitalWrite(DOOR_IN2_PIN, LOW);
  analogWrite(DOOR_EN_PIN, 0);
}

// One helper, one polarity flag (DOOR_INVERT). If the door physically opens
// when openDirection is false, flip DOOR_INVERT once and recompile.
void doorDrive(bool openDirection) {
  bool effectiveOpen = DOOR_INVERT ? !openDirection : openDirection;
  if (effectiveOpen) {
    digitalWrite(DOOR_IN1_PIN, LOW);
    digitalWrite(DOOR_IN2_PIN, HIGH);
  } else {
    digitalWrite(DOOR_IN1_PIN, HIGH);
    digitalWrite(DOOR_IN2_PIN, LOW);
  }
  analogWrite(DOOR_EN_PIN, DOOR_SPEED);
}

void doorOpenMotor() {
  doorDrive(true);
}
void doorCloseMotor() {
  doorDrive(false);
}


// =====================================================
// FRESH-START RESET
// =====================================================
void resetRuntimeState(const char* source) {
  unsigned long now = millis();

  stopStepper();
  doorStop();
  fanHardwareOff();

  requestTableClear();
  currentFloor = START_FLOOR;
  targetFloor = -1;
  segmentTargetFloor = -1;
  dispatchDirection = 0;

  prevState = ST_IDLE;
  state = ST_IDLE;
  stateEnteredMs = now;
  graceUntilMs = 0;

  moveStartMs = 0;
  stepsToDeliver = 0;
  stepsDelivered = 0;
  stepsSinceLastBoundary = 0;
  maxMoveTimeMs = 0;

  resumePendingMove = false;
  resumeTargetFloor = -1;
  resumeSegmentTargetFloor = -1;
  resumeStepsRemaining = 0;
  resumeStepsSinceLastBoundary = 0;
  resumeDirectionUp = false;
  emergencyButtonRawReading = false;
  emergencyButtonStablePressed = false;
  emergencyButtonLastEdgeMs = 0;
  emergencyButtonReleasedInEmergency = false;

  tripsToday = 0;
  doorCycleCount = 0;

  fanMode = FAN_MODE_AUTO;
  fanIsOn = false;
  fanManualState = false;
  fanReason = "IDLE";
  fanRuntimeMsToday = 0;
  fanLastOnMs = 0;
  lastFanActivityMs = 0;
  lastHotRunEndedMs = 0;
  fanHardwareOff();
  warningAlertConfirmed = false;
  warningConditionSinceMs = 0;
  adcSafetyFaultConfirmed = false;
  adcSafetyFaultSinceMs = 0;
  adcSafetyFaultReason = "NONE";
  setFaultReason("NONE");
  rfidDisplayState = RFID_NO_CARD;
  copyBounded(lastRfidUid, sizeof(lastRfidUid), "----");
  copyBounded(lastRfidRole, sizeof(lastRfidRole), "NONE");
  copyBounded(lastRfidReason, sizeof(lastRfidReason), "NO CARD");
  lastRfidAuthorized = false;
  lastRfidEventMs = 0;
  activeRfidRole = ROLE_UNKNOWN;
  activeRfidFloorMask = 0;
  activeRfidSessionUntilMs = 0;
  copyBounded(activeRfidUid, sizeof(activeRfidUid), "----");
  copyBounded(activeRfidUserName, sizeof(activeRfidUserName), "NONE");
  copyBounded(activeRfidRoleName, sizeof(activeRfidRoleName), "NONE");
  priorityServiceActive = false;
  priorityFloor = -1;
  copyBounded(prioritySource, sizeof(prioritySource), "NONE");
  priorityUntilMs = 0;
  clearPendingAuth("reset");
  lastPhysicalHallFloor = -1;
  lastPhysicalHallMs = 0;
  rfidGrantedCount = 0;
  rfidDeniedCount = 0;
  rfidUnknownCount = 0;
  rfidRevokedCount = 0;
  rfidRestrictedDeniedCount = 0;
  rfidVipServiceCount = 0;
  rfidDegradedNoticePrinted = false;
  securityLocked = false;
  lcdTestSequenceActive = false;
  buzzerStop();

  lastPublishMs = 0;
  lastMqttRetryMs = 0;
  publishNow = true;

  for (int i = 0; i < NUM_BUTTONS; i++) {
    buttons[i].lastReading = digitalRead(buttons[i].pin);
    buttons[i].stableState = buttons[i].lastReading;
    buttons[i].lastDebounce = now;
  }

  Serial.print("[RESET] fresh start");
  if (source && source[0] != '\0') {
    Serial.print(" from ");
    Serial.print(source);
  }
  Serial.print(" -> floor=");
  Serial.print(currentFloor);
  Serial.println(" state=IDLE fan=OFF/AUTO counters=0 requests=0");

  if (!source || strcmp(source, "BOOT") != 0) {
    lcdShowMessageTemporary("RESET DONE", "State: IDLE", "Requests clear", "System ready", LCD_TEMP_MESSAGE_DURATION_MS);
  }
}


// =====================================================
// EMERGENCY-STOP INPUT (placeholder, disabled unless wired)
// =====================================================
bool readEmergencyStopInput() {
  if (EMERGENCY_STOP_PIN < 0) return false;
  bool level = digitalRead(EMERGENCY_STOP_PIN);
  return EMERGENCY_STOP_ACTIVE_LOW ? (level == LOW) : (level == HIGH);
}

void clearEmergencyAndResume(const char* source);

// Debounced edge detection on the hardware E-STOP button.
//   First press while running   -> enterEmergency()
//   Second press while emergency-> clear fault to SAFE IDLE (no auto-resume, C2)
// The flag emergencyButtonReleasedInEmergency guarantees the original
// triggering press has been physically released before a fresh press can
// clear the fault.
void checkEmergencyStopInput() {
  if (EMERGENCY_STOP_PIN < 0) return;

  bool reading = readEmergencyStopInput();
  unsigned long now = millis();

  if (reading != emergencyButtonRawReading) {
    emergencyButtonLastEdgeMs = now;
    emergencyButtonRawReading = reading;
  }

  // Wait for the level to stay stable for DEBOUNCE_MS before acting on it.
  if ((now - emergencyButtonLastEdgeMs) < DEBOUNCE_MS) return;
  if (reading == emergencyButtonStablePressed) return;

  emergencyButtonStablePressed = reading;
  bool justPressed = reading;
  bool justReleased = !reading;

  if (state != ST_EMERGENCY) {
    if (justPressed) enterEmergency("Hardware E-STOP input asserted.");
    emergencyButtonReleasedInEmergency = false;
    return;
  }

  // Already in EMERGENCY: require a release first so the same press that
  // entered emergency cannot also clear it, then accept the next press.
  if (justReleased) {
    emergencyButtonReleasedInEmergency = true;
    return;
  }
  if (justPressed && emergencyButtonReleasedInEmergency) {
    clearEmergencyAndResume("Hardware E-STOP second press");
    emergencyButtonReleasedInEmergency = false;
  }
}


// =====================================================
// STATE TRANSITIONS
// =====================================================
void enterErrorStop(const char* reason) {
  stopStepper();
  doorStop();
  targetFloor = -1;
  segmentTargetFloor = -1;
  dispatchDirection = 0;
  setFaultReason(reason);
  transitionTo(ST_ERROR_STOP);
  requestBuzzerPattern(BUZZ_PATTERN_ERROR);
  Serial.println();
  Serial.println("==== ERROR STOP ====");
  Serial.println(reason);
  Serial.println("Recover with serial 'R' or MQTT {\"command\":\"RESET\"}");
  Serial.println("====================");
}

void enterEmergency(const char* reason) {
  // If we were mid-trip, memorise where we were for diagnostics / dashboard
  // display only. NOTE: clearing the fault does NOT auto-resume this trip
  // (safety item C2, see clearEmergencyAndResume); the operator must
  // deliberately re-request a floor before the car moves again.
  if ((state == ST_MOVING_UP || state == ST_MOVING_DOWN)
      && targetFloor >= 0 && targetFloor < NUM_FLOORS) {
    resumePendingMove = true;
    resumeTargetFloor = targetFloor;
    resumeSegmentTargetFloor = segmentTargetFloor;
    resumeStepsRemaining = (stepsDelivered >= stepsToDeliver)
                             ? 0
                             : (stepsToDeliver - stepsDelivered);
    // V6.1: also remember how far we are into the current floor segment so
    // the resumed trip's boundary-crossing detector aligns with reality
    // (otherwise currentFloor would drift after the resume).
    resumeStepsSinceLastBoundary = stepsSinceLastBoundary;
    resumeDirectionUp = (state == ST_MOVING_UP);
  }

  stopStepper();
  doorStop();
  // Keep targetFloor untouched when a resume is pending so the dashboard
  // still shows where the cabin is headed; otherwise clear it.
  if (!resumePendingMove) targetFloor = -1;
  setFaultReason(reason);
  transitionTo(ST_EMERGENCY);
  requestBuzzerPattern(BUZZ_PATTERN_ERROR);
  Serial.println();
  Serial.println("==== EMERGENCY ====");
  Serial.println(reason);
  if (resumePendingMove) {
    Serial.print("Position memorised: ");
    Serial.print(resumeStepsRemaining);
    Serial.print(" steps remaining to floor ");
    Serial.println(resumeTargetFloor);
  }
  Serial.println("Press E-STOP again, send 'R' / RESET, or click \"Reset / Clear Problems\" in the dashboard to recover.");
  Serial.println("===================");
}

// Restart the interrupted trip if one was memorised; otherwise fall back
// to a plain IDLE reset. Shared by serial 'R', MQTT RESET/CLEAR_EMERGENCY
// and the hardware long-press handler.
// SAFETY (C2): clearing an emergency/fault must NEVER command motion on its
// own. The E-stop was asserted because of a hazard; acknowledging it returns
// the car to a safe IDLE at its current floor and requires a fresh, deliberate
// floor request before it will move again. (Earlier firmware auto-resumed the
// interrupted trip on clear, which is an unsafe behaviour for a real elevator:
// a person who hit E-stop for safety would see the car lurch back into motion
// the instant the fault was acknowledged.)
//
// The resume* fields are still captured in enterEmergency() purely for
// diagnostics/dashboard display of where the car stopped; they are discarded
// here, never used to drive the motor.
//
// Name kept (referenced by serial 'R', MQTT RESET/CLEAR_EMERGENCY, and the
// hardware second-press handler) to limit change surface in untested firmware.
void clearEmergencyAndResume(const char* source) {
  stopStepper();
  doorStop();
  buzzerStop();
  graceUntilMs = 0;

  bool hadPendingTrip = resumePendingMove;
  int abandonedTarget = resumeTargetFloor;

  // Discard any memorised mid-trip position; we will not auto-resume it.
  resumePendingMove = false;
  resumeTargetFloor = -1;
  resumeSegmentTargetFloor = -1;
  resumeStepsRemaining = 0;
  resumeStepsSinceLastBoundary = 0;

  // Return to a safe IDLE at the current (kept) floor. Pending requests are
  // cleared so nothing dispatches without a fresh, deliberate press.
  targetFloor = -1;
  segmentTargetFloor = -1;
  dispatchDirection = 0;
  stepsToDeliver = 0;
  stepsDelivered = 0;
  stepsSinceLastBoundary = 0;
  requestTableClear();
  clearPendingAuth("emergency clear");
  transitionTo(ST_IDLE);
  setFaultReason("NONE");
  lcdShowMessageTemporary("RESET DONE", "State: IDLE", "Re-select floor", "System ready", LCD_TEMP_MESSAGE_DURATION_MS);

  Serial.print("[");
  Serial.print(source);
  Serial.print("] fault cleared -> IDLE (current floor kept");
  if (hadPendingTrip && abandonedTarget >= 0) {
    Serial.print(", trip to floor ");
    Serial.print(abandonedTarget);
    Serial.print(" NOT auto-resumed - re-request to move");
  }
  Serial.println(")");
  publishNow = true;
}

void enterDoorOpening() {
  stopStepper();
  doorOpenMotor();
  requestBuzzerPattern(BUZZ_PATTERN_DOOR);
  transitionTo(ST_DOOR_OPENING);
  Serial.println("[DOOR] OPEN pulse");
}

void enterDoorOpenWait() {
  doorStop();
  transitionTo(ST_DOOR_OPEN_WAIT);
  Serial.print("[DOOR] dwell ");
  Serial.print(DOOR_DWELL_MS);
  Serial.println(" ms");
}

void enterDoorClosing() {
  doorCloseMotor();
  requestBuzzerPattern(BUZZ_PATTERN_DOOR);
  transitionTo(ST_DOOR_CLOSING);
  Serial.println("[DOOR] CLOSE pulse");
}

void enterArrived() {
  stopStepper();
  // Calibration trace -- compare 'delivered' vs 'target' to tune STEPS_PER_FLOOR.
  unsigned long elapsed = millis() - moveStartMs;
  Serial.print("[CALIB] steps target=");
  Serial.print(stepsToDeliver);
  Serial.print(" delivered=");
  Serial.print(stepsDelivered);
  Serial.print(" elapsed=");
  Serial.print(elapsed);
  Serial.println(" ms");

  stepsToDeliver = 0;
  stepsDelivered = 0;
  stepsSinceLastBoundary = 0;
  tripsToday++;
  requestBuzzerPattern(BUZZ_PATTERN_ARRIVAL);
  transitionTo(ST_ARRIVED);
  char floorLine[LCD_COLS + 1];
  snprintf(floorLine, sizeof(floorLine), "Arrived floor %d", currentFloor);
  lcdShowMessageTemporary("ARRIVED", floorLine, "Door opening", "Please wait", LCD_TEMP_MESSAGE_DURATION_MS);
  Serial.print("[MOVE] ARRIVED at floor ");
  Serial.println(currentFloor);
}

int firstCompatibleStopInDirection(int direction) {
  if (direction > 0) {
    for (int floor = currentFloor + 1; floor < NUM_FLOORS; floor++) {
      if (hasCompatibleRequestAtFloor(floor, direction)) return floor;
    }
  } else if (direction < 0) {
    for (int floor = currentFloor - 1; floor >= 0; floor--) {
      if (hasCompatibleRequestAtFloor(floor, direction)) return floor;
    }
  }
  return -1;
}

int firstAnyStopInDirection(int direction) {
  if (direction > 0) {
    for (int floor = currentFloor + 1; floor < NUM_FLOORS; floor++) {
      if (hasRequestAtFloor(floor)) return floor;
    }
  } else if (direction < 0) {
    for (int floor = currentFloor - 1; floor >= 0; floor--) {
      if (hasRequestAtFloor(floor)) return floor;
    }
  }
  return -1;
}

int chooseNextStopInDirection(int direction) {
  int compatible = firstCompatibleStopInDirection(direction);
  if (compatible >= 0) return compatible;
  return firstAnyStopInDirection(direction);
}

int nearestRequestAbove() {
  for (int floor = currentFloor + 1; floor < NUM_FLOORS; floor++) {
    if (hasRequestAtFloor(floor)) return floor;
  }
  return -1;
}

int nearestRequestBelow() {
  for (int floor = currentFloor - 1; floor >= 0; floor--) {
    if (hasRequestAtFloor(floor)) return floor;
  }
  return -1;
}

int selectNextStop() {
  if (currentFloor >= 0 && currentFloor < NUM_FLOORS && hasRequestAtFloor(currentFloor)) {
    dispatchDirection = 0;
    return currentFloor;
  }

  int priorityStop = activePriorityStop();
  if (priorityStop >= 0) {
    dispatchDirection = (priorityStop > currentFloor) ? 1 : (priorityStop < currentFloor ? -1 : 0);
    Serial.print("[DISPATCH][RFID] priority stop selected floor ");
    Serial.println(priorityStop);
    return priorityStop;
  }

  if (dispatchDirection > 0) {
    int next = chooseNextStopInDirection(1);
    if (next >= 0) return next;
    if (hasRequestsBelow(currentFloor)) {
      dispatchDirection = -1;
      return chooseNextStopInDirection(-1);
    }
  } else if (dispatchDirection < 0) {
    int next = chooseNextStopInDirection(-1);
    if (next >= 0) return next;
    if (hasRequestsAbove(currentFloor)) {
      dispatchDirection = 1;
      return chooseNextStopInDirection(1);
    }
  }

  int above = nearestRequestAbove();
  int below = nearestRequestBelow();
  if (above < 0 && below < 0) {
    dispatchDirection = 0;
    return -1;
  }
  if (above >= 0 && below < 0) {
    dispatchDirection = 1;
    return above;
  }
  if (below >= 0 && above < 0) {
    dispatchDirection = -1;
    return below;
  }

  int upDistance = above - currentFloor;
  int downDistance = currentFloor - below;
  if (downDistance < upDistance) {
    dispatchDirection = -1;
    return below;
  }
  dispatchDirection = 1;
  return above;
}

void logChosenStop(int nextStop) {
  Serial.print("[DISPATCH] dir=");
  Serial.print(dispatchDirection > 0 ? "UP" : dispatchDirection < 0 ? "DOWN"
                                                                    : "IDLE");
  Serial.print(" current=");
  Serial.print(currentFloor);
  Serial.print(" next=");
  Serial.println(nextStop);
}

void markCurrentFloorServed(const char* reason) {
  Serial.print("[SERVE] floor ");
  Serial.print(currentFloor);
  Serial.print(" reason=");
  Serial.println(reason);
  clearServedRequestsAtFloor(
    currentFloor,
    dispatchDirection,
    CLEAR_ALL_HALL_CALLS_ON_STOP || targetFloor == currentFloor || dispatchDirection == 0);
  clearPriorityIfServed(currentFloor);
  dumpRequestTable();
}

bool shouldStopAtCurrentFloor() {
  if (!isValidFloor(currentFloor)) return false;
  if (targetFloor == currentFloor) return true;
  return hasCompatibleRequestAtFloor(currentFloor, dispatchDirection);
}

bool startMovementSegmentTowardTarget() {
  if (inFaultState()) {
    Serial.println("[MOVE] refused: in fault state");
    return false;
  }
  if (adcSafetyMovementBlocked()) {
    Serial.print("[MOVE] refused: ADC safety interlock active/pending: ");
    Serial.println(adcMovementLockoutNowReason());
    lcdShowMessageTemporary("MOVE BLOCKED", "Safety lockout", adcMovementLockoutNowReason(), "Check sensors", LCD_TEMP_MESSAGE_DURATION_MS);
    return false;
  }
  if (targetFloor < 0 || targetFloor >= NUM_FLOORS) {
    enterErrorStop("Invalid target floor.");
    return false;
  }
  if (currentFloor < 0 || currentFloor >= NUM_FLOORS) {
    enterErrorStop("Invalid current floor. Use 'H' to home before moving.");
    return false;
  }
  if (ENABLE_OVERLOAD_MOVEMENT_LOCKOUT && simulatedLoadKg >= SIM_LOAD_RATED_KG) {
    Serial.print("[SAFETY] movement blocked by simulated overload: ");
    Serial.print(simulatedLoadKg, 0);
    Serial.println(" kg");
    lcdShowMessageTemporary("OVERLOAD", "Move blocked", "Reduce load", "Then retry", LCD_TEMP_MESSAGE_DURATION_MS);
    return false;
  }
  if (!doorIsConsideredClosed()) {
    enterErrorStop("Refused to move while door is not CLOSED.");
    return false;
  }
  if (targetFloor == currentFloor) {
    markCurrentFloorServed("CURRENT_FLOOR_TARGET");
    targetFloor = -1;
    segmentTargetFloor = -1;
    enterDoorOpening();
    return true;
  }

  bool movingUp = targetFloor > currentFloor;
  dispatchDirection = movingUp ? 1 : -1;

  // V6.1: plan the ENTIRE trip to targetFloor in one go. With the old
  // per-floor segmentation the deceleration ramp engaged at every floor
  // boundary, slowing the cabin to near-stop even at floors with no
  // request. With a single multi-floor plan, intermediate floor crossings
  // are detected inside tickMoving() without breaking the ramp, so the
  // cabin cruises through pass-through floors at full speed.
  segmentTargetFloor = targetFloor;
  if (!isValidFloor(segmentTargetFloor)) {
    enterErrorStop("Invalid segment target.");
    return false;
  }

  if (movingUp) {
    setDirectionUp();
    transitionTo(ST_MOVING_UP);
  } else {
    setDirectionDown();
    transitionTo(ST_MOVING_DOWN);
  }

  int floorsToTravel = abs(targetFloor - currentFloor);
  stepsToDeliver = (unsigned long)STEPS_PER_FLOOR * (unsigned long)floorsToTravel;
  stepsDelivered = 0;
  stepsSinceLastBoundary = 0;
  moveStartMs = millis();
  // Safety budget scales with trip length so multi-floor trips don't get
  // false-stalled, with a one-floor minimum even when floorsToTravel == 1.
  maxMoveTimeMs = (unsigned long)MAX_FLOOR_TRAVEL_MS * (unsigned long)floorsToTravel;
  lastFanActivityMs = moveStartMs;

  // I2C LCD writes are slow relative to step pulse timing. Render the moving
  // status once before pulse delivery starts, then updateLCD() freezes display
  // traffic while MOVING unless LCD_UPDATE_WHILE_MOVING is explicitly enabled.
  lcdTemporaryUntilMs = 0;
  lcdTestSequenceActive = false;
  lcdForceRedraw = true;
  lcdShowMoving();
  lastLcdUpdateMs = millis();

  Serial.print("[MOVE] trip ");
  Serial.print(currentFloor);
  Serial.print(" -> ");
  Serial.print(targetFloor);
  Serial.print(" | floors=");
  Serial.print(floorsToTravel);
  Serial.print(" steps=");
  Serial.print(stepsToDeliver);
  Serial.print(" timeout=");
  Serial.print(maxMoveTimeMs);
  Serial.println(" ms");
#if PUBLISH_POSITION_WHILE_MOVING
  publishMovingPosition();  // H1: immediate "in motion" update for the twin
#endif
  return true;
}

void enterMoving(int destination) {
  if (destination < 0 || destination >= NUM_FLOORS) {
    enterErrorStop("Invalid destination floor.");
    return;
  }
  targetFloor = destination;
  logChosenStop(targetFloor);
  startMovementSegmentTowardTarget();
}


// =====================================================
// REQUEST HANDLING
// =====================================================
bool addRequestFlag(int floor, RequestType type) {
  if (!isValidHallRequest(floor, type)) return false;
  bool* slot = nullptr;
  if (type == REQ_CABIN) slot = &cabinRequests[floor];
  else if (type == REQ_HALL_UP) slot = &hallUpRequests[floor];
  else if (type == REQ_HALL_DOWN) slot = &hallDownRequests[floor];
  if (!slot || *slot) return false;
  *slot = true;
  return true;
}

void openOrExtendDoorAtCurrentFloor(const char* source) {
  markCurrentFloorServed(source);

  if (state == ST_DOOR_OPEN_WAIT) {
    stateEnteredMs = millis();
    Serial.println("[DOOR] dwell extended by same-floor request");
    return;
  }
  if (state == ST_DOOR_OPENING) {
    Serial.println("[DOOR] already opening for same-floor request");
    return;
  }
  if (state == ST_DOOR_CLOSING) {
    Serial.println("[DOOR] same-floor request while closing -> reopen");
    enterDoorOpening();
    return;
  }
  if (state == ST_ARRIVED) {
    Serial.println("[DOOR] arrival settle already scheduled for same-floor request");
    return;
  }
  if (state == ST_IDLE) {
    enterDoorOpening();
    return;
  }

  Serial.print("[REQ] same-floor door action ignored in state ");
  Serial.println(stateName(state));
}

void handleRequest(int floor, RequestType type, const char* source) {
  if (floor < 0 || floor >= NUM_FLOORS) {
    Serial.print("[REQ] invalid floor ");
    Serial.print(floor);
    Serial.print(" (from ");
    Serial.print(source);
    Serial.println(") ignored");
    lcdShowMessageTemporary("REQUEST DENIED", "Invalid floor", "Use 0..3", "Check command", LCD_TEMP_MESSAGE_DURATION_MS);
    return;
  }
  if (!isValidHallRequest(floor, type)) {
    Serial.print("[REQ] invalid ");
    Serial.print(requestTypeName(type));
    Serial.print(" at endpoint floor ");
    Serial.print(floor);
    Serial.print(" (from ");
    Serial.print(source);
    Serial.println(") ignored");
    lcdShowMessageTemporary("REQUEST DENIED", "Invalid hall", "Endpoint call", "ignored", LCD_TEMP_MESSAGE_DURATION_MS);
    return;
  }
  if (inFaultState()) {
    Serial.print("[REQ] refused: state=");
    Serial.println(stateName(state));
    lcdShowMessageTemporary("REQUEST DENIED", "Fault active", "Press R reset", lastFaultReason, LCD_TEMP_MESSAGE_DURATION_MS);
    return;
  }
  if (securityLocked) {
    Serial.println("[REQ] refused: security lockdown active");
    lcdShowMessageTemporary("REQUEST DENIED", "Security lock", "Calls blocked", "Contact admin", LCD_TEMP_MESSAGE_DURATION_MS);
    return;
  }
  // WHO/WHERE pairing: remember the most recent physical hall press so a VIP
  // scan can prioritise the floor the call is made FROM.
  if (source && strncmp(source, "OUT", 3) == 0 && (type == REQ_HALL_UP || type == REQ_HALL_DOWN)) {
    lastPhysicalHallFloor = floor;
    lastPhysicalHallMs = millis();
  }

  if (!rfidRequestAllowed(floor, type, source)) {
    // A physical hall/cabin press needs a card. If no session is active yet AND a
    // reader is present, remember the press and wait for a scan (press-then-scan).
    // A session active but whose mask excludes the floor is a hard denial.
    bool physicalPress = source && (strncmp(source, "CABIN", 5) == 0 || strncmp(source, "OUT", 3) == 0);
    if (physicalPress && rfidReady && !rfidSessionActive()) {
      parkAuthRequest(floor, type);
      char fl[LCD_COLS + 1];
      snprintf(fl, sizeof(fl), "For floor %d", floor);
      lcdShowMessageTemporary("SCAN CARD", fl, "Access locked", "Tap RFID tag", LCD_TEMP_MESSAGE_DURATION_MS);
      requestBuzzerPattern(BUZZ_PATTERN_QUEUED);
      Serial.print("[REQ][RFID] floor ");
      Serial.print(floor);
      Serial.print(" (");
      Serial.print(requestTypeName(type));
      Serial.println(") awaiting card authorization");
    } else {
      lcdShowMessageTemporary("REQUEST DENIED", "RFID policy", lastRfidReason, "Scan card", LCD_TEMP_MESSAGE_DURATION_MS);
    }
    return;
  }
  if (adcSafetyMovementBlocked()) {
    Serial.print("[REQ] refused: ADC safety interlock active/pending: ");
    Serial.println(adcMovementLockoutNowReason());
    lcdShowMessageTemporary("REQUEST DENIED", "Safety lockout", adcMovementLockoutNowReason(), "Check sensors", LCD_TEMP_MESSAGE_DURATION_MS);
    return;
  }
  Serial.print("[REQ] floor ");
  Serial.print(floor);
  Serial.print(" type=");
  Serial.print(requestTypeName(type));
  Serial.print(" from ");
  Serial.println(source);

  bool added = addRequestFlag(floor, type);
  if (!added) {
    Serial.println("[REQ] duplicate request ignored");
    char msg[LCD_COLS + 1];
    snprintf(msg, sizeof(msg), "Floor %d queued", floor);
    lcdShowMessageTemporary("DUPLICATE REQ", msg, "Already pending", "No new action", LCD_TEMP_MESSAGE_DURATION_MS);
  } else {
    bool queued = (state != ST_IDLE) || isMovingState();
    requestBuzzerPattern(queued ? BUZZ_PATTERN_QUEUED : BUZZ_PATTERN_BUTTON);
    char msg[LCD_COLS + 1];
    snprintf(msg, sizeof(msg), queued ? "QUEUED F:%d" : "REQ FLOOR %d", floor);
    lcdShowMessageTemporary(msg, queued ? "Floor queued" : "Button accepted", requestTypeName(type), source, LCD_TEMP_MESSAGE_DURATION_MS);
  }

  if (floor == currentFloor && !isMovingState()) {
    openOrExtendDoorAtCurrentFloor(source);
    publishNow = true;
    return;
  }

  if (state == ST_IDLE) {
    dispatchNextRequest();
  } else if (isMovingState()) {
    int reqDir = requestTypeDirection(type);
    bool ahead = (dispatchDirection > 0 && floor > currentFloor) || (dispatchDirection < 0 && floor < currentFloor);
    bool compatible = (type == REQ_CABIN) || reqDir == dispatchDirection;
    Serial.print("[REQ] moving ");
    Serial.print(dispatchDirection > 0 ? "UP" : "DOWN");
    Serial.print(ahead && compatible ? " compatible pickup candidate" : " queued for later");
    Serial.println();

    // V6.1: actually act on the pickup — retarget the in-flight trip to land
    // at this floor if it's between us and the current destination and we
    // still have braking room. Without this, a same-direction hall press
    // arriving mid-segment would be deferred until the next floor boundary
    // check, by which time the cabin may have already passed the floor.
    if (ahead && compatible) {
      redirectTrip(floor, "live pickup");
    }
  }

  dumpRequestTable();
  publishNow = true;
}

void handleFloorRequest(int floor, const char* source) {
  handleRequest(floor, REQ_CABIN, source);
}

// Called every loop tick when we are IDLE.
void dispatchNextRequest() {
  if (state != ST_IDLE) return;
  if (securityLocked) return;  // F3: no dispatch while locked down
  if (millis() < graceUntilMs) return;
  if (adcSafetyMovementBlocked()) return;
  int next = selectNextStop();
  if (next < 0) {
    targetFloor = -1;
    segmentTargetFloor = -1;
    dispatchDirection = 0;
    return;
  }
  logChosenStop(next);
  if (next == currentFloor) {
    openOrExtendDoorAtCurrentFloor("DISPATCH_CURRENT");
  } else {
    enterMoving(next);
  }
}


// =====================================================
// STATE TICKERS
// =====================================================
void tickDoorOpening() {
  if (millis() - stateEnteredMs >= DOOR_PULSE_MS) enterDoorOpenWait();
}

void tickDoorOpenWait() {
  if (millis() - stateEnteredMs >= DOOR_DWELL_MS) enterDoorClosing();
}

void tickDoorClosing() {
  if (millis() - stateEnteredMs >= DOOR_PULSE_MS) {
    doorStop();
    doorCycleCount++;
    graceUntilMs = millis() + INTERREQUEST_GRACE_MS;
    transitionTo(ST_IDLE);
    Serial.println("[DOOR] closed -> IDLE");
  }
}

void tickArrived() {
  // Brief settle window before opening the door so the stepper releases
  // cleanly before the door driver wakes up.
  if (millis() - stateEnteredMs >= ARRIVE_SETTLE_MS) enterDoorOpening();
}

// Trip-complete handler. With V6.1 multi-floor planning there is no longer
// such a thing as "next segment within a trip"; the trip lands at the
// planned target floor (possibly retargeted mid-trip by a same-direction
// pickup at the next boundary).
void completeMovementSegment() {
  stopStepper();
  if (!isValidFloor(segmentTargetFloor)) {
    enterErrorStop("Trip completed with invalid floor target.");
    return;
  }

  currentFloor = segmentTargetFloor;
  stepsSinceLastBoundary = 0;
  Serial.print("[MOVE] arrived at floor ");
  Serial.println(currentFloor);

  markCurrentFloorServed(targetFloor == currentFloor ? "TARGET" : "COMPATIBLE_PICKUP");
  targetFloor = -1;
  segmentTargetFloor = -1;
  enterArrived();
}

// Mid-trip retargeting: a new request appeared while the cabin is moving.
// If `newTargetFloor` is reachable in the current direction, not past the
// current target, and we still have enough remaining travel to decelerate
// cleanly, shorten the trip so the cabin lands there. Returns true if the
// trip was actually retargeted.
//
// Called from two places:
//   1. tickMoving() boundary crossing — the freshly-entered floor sees that
//      the next floor has a same-direction request waiting.
//   2. handleRequest() while moving — a brand-new button press for a floor
//      ahead in the current direction needs to be picked up now, not after
//      the next boundary tick (which may be several thousand steps away).
static bool redirectTrip(int newTargetFloor, const char* reason) {
  if (!isMovingState()) return false;
  if (!isValidFloor(newTargetFloor)) return false;
  if (dispatchDirection == 0) return false;

  // Must be ahead of the cabin's current physical position.
  bool ahead = (dispatchDirection > 0 && newTargetFloor > currentFloor) || (dispatchDirection < 0 && newTargetFloor < currentFloor);
  if (!ahead) return false;

  // Already heading exactly there.
  if (newTargetFloor == targetFloor) return false;

  // Only ACCEPT shorter trips. A request further than the current target is
  // left for the next dispatch instead of extending the current trip past
  // the planned stop.
  bool closerThanTarget = (dispatchDirection > 0 && newTargetFloor <= targetFloor) || (dispatchDirection < 0 && newTargetFloor >= targetFloor);
  if (!closerThanTarget) return false;

  // Remaining step distance to land at newTargetFloor:
  //   floors_remaining * STEPS_PER_FLOOR - already_taken_in_current_segment
  unsigned long floorsAhead = (unsigned long)abs(newTargetFloor - currentFloor);
  unsigned long stepsToReach = floorsAhead * (unsigned long)STEPS_PER_FLOOR;
  if (stepsSinceLastBoundary > stepsToReach) {
    // Defensive: should not happen, but avoids underflow.
    return false;
  }
  stepsToReach -= stepsSinceLastBoundary;

  // The decel ramp needs at least STEP_DECEL_STEPS of distance to brake
  // cleanly. If we are already too close to the floor, defer the pickup so
  // we don't have to overshoot or stop the motor abruptly.
  if (stepsToReach < (unsigned long)STEP_DECEL_STEPS) {
    Serial.print("[MOVE] retarget to floor ");
    Serial.print(newTargetFloor);
    Serial.print(" deferred (only ");
    Serial.print(stepsToReach);
    Serial.print(" steps left, need ");
    Serial.print((unsigned long)STEP_DECEL_STEPS);
    Serial.println(" to brake)");
    return false;
  }

  targetFloor = newTargetFloor;
  segmentTargetFloor = newTargetFloor;
  stepsToDeliver = stepsDelivered + stepsToReach;
  // Refresh the safety budget proportionally to the remaining work.
  maxMoveTimeMs = (millis() - moveStartMs) + (unsigned long)MAX_FLOOR_TRAVEL_MS * floorsAhead;

  Serial.print("[MOVE] retarget to floor ");
  Serial.print(newTargetFloor);
  Serial.print(" (");
  Serial.print(reason ? reason : "redirect");
  Serial.print(", ");
  Serial.print(stepsToReach);
  Serial.println(" steps to land)");
  return true;
}

// V6.1: continuous multi-floor travel.
//   * stepsToDeliver covers the whole trip (no per-floor segmentation).
//   * The accel/decel ramp engages once at trip start and once at the actual
//     stop, so pass-through floors are crossed at cruise speed.
//   * Each physical floor boundary crossing updates currentFloor and gives
//     the dispatcher a chance to convert a fresh same-direction request at
//     the upcoming floor into a stop without leaving the moving state.
void tickMoving() {
  unsigned long elapsed = millis() - moveStartMs;

  // Safety: if we cannot deliver the planned step count in a reasonable
  // wall-clock window, something is mechanically wrong (stall, blocked
  // cable, runaway loop overhead). Trip ERROR_STOP rather than spinning.
  if (elapsed > maxMoveTimeMs) {
    Serial.print("[MOVE] safety timeout: delivered=");
    Serial.print(stepsDelivered);
    Serial.print(" / target=");
    Serial.println(stepsToDeliver);
    enterErrorStop("Step delivery timed out (possible stall).");
    return;
  }

  if (stepsDelivered >= stepsToDeliver) {
    completeMovementSegment();
    return;
  }

  stepOnce(currentStepDelayUs());
  stepsDelivered++;
  stepsSinceLastBoundary++;

  // Detect a floor-boundary crossing. We treat STEPS_PER_FLOOR step pulses
  // as one floor of physical travel. The crossing is acted on only when
  // there is still more trip ahead (stepsDelivered < stepsToDeliver), so
  // landing at the actual target floor is handled by the arrival branch
  // above on the next tick.
  if (stepsSinceLastBoundary >= (unsigned long)STEPS_PER_FLOOR
      && stepsDelivered < stepsToDeliver) {
    stepsSinceLastBoundary = 0;
    currentFloor += dispatchDirection;
    // Objective 2 (stepper-lag fix): the per-boundary Serial.print was removed
    // from this hot path -- at 115200 baud it blocked ~1.7 ms BETWEEN two step
    // pulses, producing a per-floor hitch. The dashboard still observes the
    // crossing via publishMovingPosition() below.

    // Same-direction pickup opportunity: if a request appeared at the floor
    // we are about to enter next, land there instead of cruising past.
    int nextFloor = currentFloor + dispatchDirection;
    if (isValidFloor(nextFloor)
        && hasCompatibleRequestAtFloor(nextFloor, dispatchDirection)) {
      redirectTrip(nextFloor, "boundary pickup");
    }
#if PUBLISH_POSITION_WHILE_MOVING
    publishMovingPosition();  // H1: live floor update during travel
#endif
  }
}


// =====================================================
// BUTTONS
// =====================================================
void readButtons() {
  for (int i = 0; i < NUM_BUTTONS; i++) {
    bool reading = digitalRead(buttons[i].pin);
    if (reading != buttons[i].lastReading) {
      buttons[i].lastDebounce = millis();
      buttons[i].lastReading = reading;
    }
    if ((millis() - buttons[i].lastDebounce) > DEBOUNCE_MS) {
      if (reading != buttons[i].stableState) {
        buttons[i].stableState = reading;
        if (buttons[i].stableState == LOW) {
          handleRequest(buttons[i].floor, buttons[i].type, buttons[i].name);
        }
      }
    }
  }
}


// =====================================================
// SERIAL DEBUG INTERFACE
// =====================================================
void handleSerialCommands() {
  if (!Serial.available()) return;
  char c = Serial.read();

  if (c >= '0' && c <= '3') {
    handleFloorRequest(c - '0', "SERIAL");
    return;
  }

  if (c == 'F') {
    fanMode = FAN_MODE_MANUAL;
    fanManualState = true;
    setFanState(true, "SERIAL_FORCE_ON");
    publishNow = true;
    Serial.println("[SERIAL] FAN -> MANUAL ON (GPIO OUTPUT LOW)");
    return;
  }
  if (c == 'f') {
    fanMode = FAN_MODE_MANUAL;
    fanManualState = false;
    setFanState(false, "SERIAL_FORCE_OFF");
    publishNow = true;
    Serial.println("[SERIAL] FAN -> MANUAL OFF (GPIO INPUT/high-Z)");
    return;
  }
  if (c == 'U') {
    fanForceOutputHighDiagnostic();
    return;
  }
  if (c == 'u') {
    fanForceOutputLowDiagnostic();
    return;
  }
  if (c == 'Z') {
    fanForceInputDiagnostic(false);
    return;
  }
  if (c == 'z') {
    fanForceInputDiagnostic(true);
    return;
  }
  if (c == 'a') {
    fanMode = FAN_MODE_AUTO;
    publishNow = true;
    updateFanAuto();
    Serial.println("[SERIAL] FAN -> AUTO");
    return;
  }
  if (c == 'x') {
    resetRuntimeState("SERIAL");
    return;
  }
  if (c == 'I') {
    lcdScanI2CBus();
    return;
  }
  if (c == 'J') {
    lcdScanSafeI2CPinPairs();
    return;
  }
  if (c == 'K') {
    if (isMovingState()) {
      Serial.println("[LCD] reinit skipped while moving to protect step timing");
      return;
    }
    Serial.println("[LCD] reinitializing LCD HMI");
    setupLCD();
    updateLCD();
    return;
  }
  if (c == 'C') {
    if (!lcdReady) {
      Serial.println("[LCD] clear skipped: LCD not ready / I2C backpack not detected");
      return;
    }
    if (isMovingState()) {
      Serial.println("[LCD] clear skipped while moving to protect step timing");
      return;
    }
    for (uint8_t row = 0; row < LCD_ROWS; row++) lcdClearLine(row);
    lcdForceRedraw = true;
    Serial.println("[LCD] cleared");
    return;
  }
  if (c == 'D') {
    printLcdConfiguration();
    return;
  }
  if (c == 'L') {
    runLcdScreenTest();
    return;
  }
  if (c == 'G') {
    recordRfidEvent(true, "ADMIN", "DEMO1234", "SERIAL TEST");
    return;
  }
  if (c == 'g') {
    recordRfidEvent(false, "UNKNOWN", "BADCAFE", "UNKNOWN CARD");
    return;
  }
  if (c == 'P') {
    printRfidStatus();
    return;
  }

  if (c == 'r' || c == 'R') {
    clearEmergencyAndResume("SERIAL");
    return;
  }
  if (c == 'b' || c == 'B') {
    requestBuzzerPattern(BUZZ_PATTERN_BUTTON);
    Serial.println("[SERIAL] buzzer test: normal button beep");
    return;
  }
  if (c == 'T') {
    startBuzzerRawLevelTest(true);
    return;
  }
  if (c == 't') {
    startBuzzerRawLevelTest(false);
    return;
  }
  if (c == 'n' || c == 'N') {
    buzzerReleasePin();
    Serial.println("[SERIAL] buzzer GPIO released/off");
    return;
  }
  if (c == 'w' || c == 'W') {
    requestBuzzerPattern(BUZZ_PATTERN_WARNING_TEST);
    Serial.println("[SERIAL] warning alert test");
    return;
  }
  if (c == 'h' || c == 'H') {
    currentFloor = START_FLOOR;
    targetFloor = -1;
    segmentTargetFloor = -1;
    dispatchDirection = 0;
    stepsToDeliver = stepsDelivered = 0;
    stepsSinceLastBoundary = 0;
    resumePendingMove = false;
    resumeTargetFloor = -1;
    resumeSegmentTargetFloor = -1;
    resumeStepsRemaining = 0;
    resumeStepsSinceLastBoundary = 0;
    requestTableClear();
    buzzerStop();
    setFaultReason("NONE");
    transitionTo(ST_IDLE);
    lcdShowMessageTemporary("HOME SET", "Floor calibrated", "Current floor 0", "System ready", LCD_TEMP_MESSAGE_DURATION_MS);
    Serial.print("[SERIAL] HOME -> currentFloor = ");
    Serial.println(currentFloor);
    return;
  }
  if (c == 's' || c == 'S') {
    enterErrorStop("Manual stop from serial monitor.");
    return;
  }
  if (c == 'e' || c == 'E') {
    enterEmergency("Manual emergency from serial monitor.");
    return;
  }
  if (c == 'q' || c == 'Q') {
    dumpRequestTable();
    return;
  }
}


// =====================================================
// TWIN MAPPING HELPERS
// =====================================================
const char* twinDoorState() {
  switch (state) {
    case ST_DOOR_OPENING: return "OPENING";
    case ST_DOOR_OPEN_WAIT: return "OPEN";
    case ST_DOOR_CLOSING: return "CLOSING";
    default: return "CLOSED";
  }
}

const char* twinDirection() {
  if (state == ST_MOVING_UP) return "UP";
  if (state == ST_MOVING_DOWN) return "DOWN";
  return "IDLE";
}

float twinSpeedMs() {
  if (!isMovingState()) return 0.0f;
  // Cruise speed assumed; an exact computation would use STEPS_PER_FLOOR and
  // the current step delay, but the dashboard only needs a representative value.
  float secPerFloor = (float)STEPS_PER_FLOOR * (float)STEP_DELAY_FAST_US / 1.0e6f;
  if (secPerFloor < 0.001f) return 0.0f;
  return FLOOR_HEIGHT_M / secPerFloor;
}

const char* twinMotorHealth() {
  if (inFaultState()) return "CRITICAL";
  if (adcSafetyFaultConfirmed) return "CRITICAL";
  if (simulatedTemperatureC >= SIM_TEMP_CRITICAL_C || simulatedVibrationG >= SIM_VIB_CRITICAL_G) return "CRITICAL";
  if (simulatedTemperatureC >= SIM_TEMP_WARNING_C || simulatedVibrationG >= SIM_VIB_WARNING_G) return "WARNING";
  return "GOOD";
}


// =====================================================
// LCD 1604A I2C LOCAL HMI
// =====================================================
void formatLCDText(const char* input, char* output, size_t outputSize) {
  if (!output || outputSize == 0) return;
  size_t usable = min((size_t)LCD_COLS, outputSize - 1);
  size_t i = 0;
  for (; i < usable; i++) {
    if (input && input[i] != '\0') output[i] = input[i];
    else output[i] = ' ';
  }
  output[usable] = '\0';
}

const char* lcdStateLabel() {
  switch (state) {
    case ST_IDLE: return "IDLE";
    case ST_DOOR_OPENING: return "DOOR_OPEN";
    case ST_DOOR_OPEN_WAIT: return "DOOR_WAIT";
    case ST_DOOR_CLOSING: return "DOOR_CLOSE";
    case ST_MOVING_UP:
    case ST_MOVING_DOWN: return "MOVING";
    case ST_ARRIVED: return "ARRIVED";
    case ST_ERROR_STOP: return "ERROR";
    case ST_EMERGENCY: return "EMERGENCY";
  }
  return "UNKNOWN";
}

const char* lcdDoorLabel() {
  switch (state) {
    case ST_DOOR_OPENING: return "OPENING";
    case ST_DOOR_OPEN_WAIT: return "WAIT";
    case ST_DOOR_CLOSING: return "CLOSING";
    default: return "CLOSED";
  }
}

const char* lcdDirectionLabel() {
  if (state == ST_MOVING_UP || dispatchDirection > 0) return "UP";
  if (state == ST_MOVING_DOWN || dispatchDirection < 0) return "DOWN";
  return "IDLE";
}

int lcdDisplayTargetFloor() {
  if (targetFloor >= 0 && targetFloor < NUM_FLOORS) return targetFloor;
  return currentFloor;
}

void lcdFormatTopLine(char* line, size_t lineSize) {
  snprintf(line, lineSize, "F:%d T:%d %s", currentFloor, lcdDisplayTargetFloor(), lcdDirectionLabel());
}

void lcdFormatTelemetryLine(char* line, size_t lineSize) {
#if LCD_SHOW_TELEMETRY
  int tempC = (int)(simulatedTemperatureC + 0.5f);
  int vibCenti = (int)(simulatedVibrationG * 100.0f + 0.5f);
  int loadKg = (int)(simulatedLoadKg + 0.5f);
  snprintf(line, lineSize, "T%dC V.%02d L%d", tempC, vibCenti, loadKg);
#else
  snprintf(line, lineSize, "Ready");
#endif
}

void lcdFormatDoorSecurityLine(char* line, size_t lineSize) {
#if LCD_SHOW_RFID_STATUS
  snprintf(line, lineSize, "D:%s RF:%s", lcdDoorLabel(), rfidShortLabel());
#else
  snprintf(line, lineSize, "Door:%s", lcdDoorLabel());
#endif
}

const char* lcdWarningTitle() {
  if (simulatedLoadKg >= SIM_LOAD_RATED_KG) return "OVERLOAD";
  if (simulatedTemperatureC >= SIM_TEMP_WARNING_C) return "TEMP HIGH";
  if (simulatedVibrationG >= SIM_VIB_WARNING_G) return "VIB WARNING";
  return "WARNING";
}

void lcdSetLines(const char* line1, const char* line2, const char* line3, const char* line4) {
  if (!lcdReady) return;

  const char* requested[LCD_ROWS] = { line1, line2, line3, line4 };
  for (uint8_t row = 0; row < LCD_ROWS; row++) {
    char formatted[LCD_COLS + 1];
    formatLCDText(requested[row], formatted, sizeof(formatted));
    if (lcdForceRedraw || strcmp(lcdRenderedLines[row], formatted) != 0) {
#if ENABLE_LCD
      if (lcdDevice) {
        lcdDevice->setCursor(0, row);
        lcdDevice->print(formatted);
      }
#endif
      copyBounded(lcdRenderedLines[row], sizeof(lcdRenderedLines[row]), formatted);
    }
  }
  lcdForceRedraw = false;
}

#if ENABLE_LCD
bool lcdProbeAddress(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

LiquidCrystal_I2C* selectLcdDevice() {
  if (lcdProbeAddress(LCD_I2C_ADDRESS)) {
    lcdActiveAddress = LCD_I2C_ADDRESS;
    return &lcdConfigured;
  }
  if (LCD_I2C_ADDRESS != 0x27 && lcdProbeAddress(0x27)) {
    lcdActiveAddress = 0x27;
    return &lcdAddress27;
  }
  if (LCD_I2C_ADDRESS != 0x3F && lcdProbeAddress(0x3F)) {
    lcdActiveAddress = 0x3F;
    return &lcdAddress3F;
  }
  return nullptr;
}
#endif

void lcdScanI2CBus() {
#if ENABLE_LCD
  if (isMovingState()) {
    Serial.println("[LCD][I2C] scan skipped while moving to protect step timing");
    return;
  }

  Serial.println("[LCD][I2C] scanning bus...");
  uint8_t found = 0;
  for (uint8_t address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    uint8_t error = Wire.endTransmission();
    if (error == 0) {
      Serial.print("[LCD][I2C] found 0x");
      if (address < 16) Serial.print("0");
      Serial.println(address, HEX);
      found++;
    }
  }
  if (found == 0) {
    Serial.println("[LCD][I2C] no devices found. Check SDA/SCL, GND, VCC, address, and pull-ups.");
  } else {
    Serial.print("[LCD][I2C] devices found: ");
    Serial.println(found);
  }
  Serial.println("[LCD][I2C] common LCD backpacks: 0x27 or 0x3F");
#else
  Serial.println("[LCD] disabled at compile time; I2C scan unavailable");
#endif
}

uint8_t lcdScanCurrentWireBus(bool verbose) {
#if ENABLE_LCD
  uint8_t found = 0;
  for (uint8_t address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    uint8_t error = Wire.endTransmission();
    if (error == 0) {
      if (verbose) {
        Serial.print("[LCD][I2C] found 0x");
        if (address < 16) Serial.print("0");
        Serial.println(address, HEX);
      }
      found++;
    }
  }
  return found;
#else
  (void)verbose;
  return 0;
#endif
}

void lcdScanSafeI2CPinPairs() {
#if ENABLE_LCD
  if (isMovingState()) {
    Serial.println("[LCD][I2C] pin-pair scan skipped while moving to protect step timing");
    return;
  }

  struct I2CPinPair {
    int sda;
    int scl;
    const char* label;
  };

  const I2CPinPair pairs[] = {
    { LCD_SDA_PIN, LCD_SCL_PIN, "configured" },
    { LCD_SCL_PIN, LCD_SDA_PIN, "configured reversed" },
    { 7, 8, "free candidate" },
    { 8, 7, "free candidate reversed" },
    { 15, 21, "free candidate" },
    { 21, 15, "free candidate reversed" }
  };

  Serial.println("[LCD][I2C] scanning safe candidate pin pairs...");
  for (uint8_t i = 0; i < sizeof(pairs) / sizeof(pairs[0]); i++) {
    Serial.print("[LCD][I2C] SDA GPIO");
    Serial.print(pairs[i].sda);
    Serial.print(" SCL GPIO");
    Serial.print(pairs[i].scl);
    Serial.print(" (");
    Serial.print(pairs[i].label);
    Serial.println(")");

    Wire.begin(pairs[i].sda, pairs[i].scl);
    Wire.setClock(LCD_I2C_CLOCK_HZ);
    delay(5);
    uint8_t found = lcdScanCurrentWireBus(true);
    if (found == 0) Serial.println("[LCD][I2C]   no devices");
  }

  Wire.begin(LCD_SDA_PIN, LCD_SCL_PIN);
  Wire.setClock(LCD_I2C_CLOCK_HZ);
  Serial.println("[LCD][I2C] restored configured LCD pins");
  Serial.println("[LCD][I2C] if all pairs show no devices, check wiring, shared GND, backpack soldering, and pull-ups");
#else
  Serial.println("[LCD] disabled at compile time; pin-pair scan unavailable");
#endif
}

void printLcdConfiguration() {
  Serial.println("[LCD] configuration");
  Serial.print("  ENABLE_LCD       : ");
  Serial.println(ENABLE_LCD ? "true" : "false");
  Serial.print("  Config address   : 0x");
  Serial.println(LCD_I2C_ADDRESS, HEX);
  Serial.print("  Active address   : 0x");
  Serial.println(lcdActiveAddress, HEX);
  Serial.print("  Geometry         : ");
  Serial.print(LCD_COLS);
  Serial.print("x");
  Serial.println(LCD_ROWS);
  Serial.print("  SDA/SCL GPIO     : ");
  Serial.print(LCD_SDA_PIN);
  Serial.print(" / ");
  Serial.println(LCD_SCL_PIN);
  Serial.print("  I2C clock        : ");
  Serial.print(LCD_I2C_CLOCK_HZ);
  Serial.println(" Hz");
  Serial.print("  Update interval  : ");
  Serial.print(LCD_UPDATE_INTERVAL_MS);
  Serial.println(" ms");
  Serial.print("  Update in moving : ");
  Serial.println(LCD_UPDATE_WHILE_MOVING ? "yes" : "no");
  Serial.print("  LCD ready        : ");
  Serial.println(lcdReady ? "yes" : "no");
  Serial.println("  Electrical note  : level-shift SDA/SCL if backpack pull-ups go to 5 V");
}

void setupLCD() {
  for (uint8_t row = 0; row < LCD_ROWS; row++) {
    lcdRenderedLines[row][0] = '\0';
    lcdTemporaryLines[row][0] = '\0';
  }

#if ENABLE_LCD
  Wire.begin(LCD_SDA_PIN, LCD_SCL_PIN);
  Wire.setClock(LCD_I2C_CLOCK_HZ);

  lcdDevice = selectLcdDevice();
  if (!lcdDevice) {
    lcdReady = false;
    Serial.print("[LCD] not detected at configured/common addresses on SDA GPIO");
    Serial.print(LCD_SDA_PIN);
    Serial.print(" SCL GPIO");
    Serial.println(LCD_SCL_PIN);
    Serial.println("[LCD] black squares mean the LCD has power but the I2C backpack was not initialized");
    lcdScanI2CBus();
    return;
  }

  lcdReady = true;
  lcdDevice->init();
  lcdDevice->backlight();
  lcdDevice->clear();
  lcdForceRedraw = true;
  lcdShowStartup();

  Serial.print("[LCD] ready: address=0x");
  Serial.print(lcdActiveAddress, HEX);
  Serial.print(" size=");
  Serial.print(LCD_COLS);
  Serial.print("x");
  Serial.print(LCD_ROWS);
  Serial.print(" SDA=");
  Serial.print(LCD_SDA_PIN);
  Serial.print(" SCL=");
  Serial.println(LCD_SCL_PIN);
#else
  lcdReady = false;
  Serial.println("[LCD] disabled. Set ENABLE_LCD to 1 and install LiquidCrystal_I2C to enable HMI.");
#endif
}

void lcdShowStartup() {
  lcdStartupUntilMs = millis() + LCD_TEMP_MESSAGE_DURATION_MS;
  lcdSetLines("SMART ELEVATOR", "ESP32-S3 SYSTEM", "INIT...", "CHECKING MODULES");
}

void lcdClearLine(uint8_t row) {
  if (!lcdReady || row >= LCD_ROWS) return;
  char blank[LCD_COLS + 1];
  formatLCDText("", blank, sizeof(blank));
#if ENABLE_LCD
  if (lcdDevice) {
    lcdDevice->setCursor(0, row);
    lcdDevice->print(blank);
  }
#endif
  copyBounded(lcdRenderedLines[row], sizeof(lcdRenderedLines[row]), blank);
}

void lcdShowMessageTemporary(const char* line1, const char* line2, const char* line3, const char* line4, unsigned long durationMs) {
  const char* requested[LCD_ROWS] = { line1, line2, line3, line4 };
  for (uint8_t row = 0; row < LCD_ROWS; row++) {
    formatLCDText(requested[row], lcdTemporaryLines[row], sizeof(lcdTemporaryLines[row]));
  }
  lcdTemporaryUntilMs = millis() + (durationMs > 0 ? durationMs : LCD_TEMP_MESSAGE_DURATION_MS);
  lcdForceRedraw = true;
  lastLcdUpdateMs = 0;
}

void lcdShowNormal() {
  char line1[LCD_COLS + 1];
  char line2[LCD_COLS + 1];
  char line3[LCD_COLS + 1];
  char line4[LCD_COLS + 1];
  lcdFormatTopLine(line1, sizeof(line1));
  snprintf(line2, sizeof(line2), "State:%s R%d", lcdStateLabel(), pendingRequestCount());
  lcdFormatDoorSecurityLine(line3, sizeof(line3));
  lcdFormatTelemetryLine(line4, sizeof(line4));
  lcdSetLines(line1, line2, line3, line4);
}

void lcdShowMoving() {
  char line1[LCD_COLS + 1];
  char line2[LCD_COLS + 1];
  char line3[LCD_COLS + 1];
  char line4[LCD_COLS + 1];
  lcdFormatTopLine(line1, sizeof(line1));
  snprintf(line2, sizeof(line2), "State:MOVING R%d", pendingRequestCount());
  lcdFormatDoorSecurityLine(line3, sizeof(line3));
  lcdFormatTelemetryLine(line4, sizeof(line4));
  lcdSetLines(line1, line2, line3, line4);
}

void lcdShowDoor() {
  char line1[LCD_COLS + 1];
  char line2[LCD_COLS + 1];
  char line3[LCD_COLS + 1];
  char line4[LCD_COLS + 1];
  lcdFormatTopLine(line1, sizeof(line1));
  snprintf(line2, sizeof(line2), "State:%s", lcdStateLabel());
  lcdFormatDoorSecurityLine(line3, sizeof(line3));

  if (state == ST_DOOR_OPEN_WAIT) {
    unsigned long elapsed = millis() - stateEnteredMs;
    unsigned long remainingMs = (elapsed >= DOOR_DWELL_MS) ? 0 : (DOOR_DWELL_MS - elapsed);
    snprintf(line4, sizeof(line4), "Wait:%lus R:%d", (remainingMs + 999) / 1000, pendingRequestCount());
  } else {
    lcdFormatTelemetryLine(line4, sizeof(line4));
  }
  lcdSetLines(line1, line2, line3, line4);
}

void lcdShowWarning() {
  char line3[LCD_COLS + 1];
  const char* title = lcdWarningTitle();
  const char* action = "Check Motor";

  if (!strcmp(title, "OVERLOAD")) {
    snprintf(line3, sizeof(line3), "L:%.0f/%.0fkg", simulatedLoadKg, SIM_LOAD_RATED_KG);
    action = "Reduce Load";
  } else if (!strcmp(title, "TEMP HIGH")) {
    snprintf(line3, sizeof(line3), "T:%.0fC", simulatedTemperatureC);
    action = "Check Motor";
  } else if (!strcmp(title, "VIB WARNING")) {
    int vibCenti = (int)(simulatedVibrationG * 100.0f + 0.5f);
    snprintf(line3, sizeof(line3), "V:.%02dg", vibCenti);
    action = "Check Motor";
  } else {
    lcdFormatTelemetryLine(line3, sizeof(line3));
  }

  lcdSetLines("WARNING", title, line3, action);
}

void lcdShowError() {
  if (state == ST_EMERGENCY) {
    lcdSetLines("!! EMERGENCY !!", "SYSTEM STOPPED", lastFaultReason, "Press R reset");
  } else {
    lcdSetLines("!!! ERROR !!!", "MOTOR STOPPED", lastFaultReason, "Press R reset");
  }
}

void runLcdScreenTest() {
  if (!lcdReady) {
    Serial.println("[LCD] screen test skipped: LCD not ready");
    return;
  }
  if (isMovingState()) {
    Serial.println("[LCD] screen test skipped while moving to protect step timing");
    return;
  }
  lcdTestSequenceActive = true;
  lcdTestStep = 0;
  lcdTestStepUntilMs = 0;
  lcdForceRedraw = true;
  lastLcdUpdateMs = 0;
  Serial.println("[LCD] non-blocking screen test started");
}

bool lcdRenderTestSequence(unsigned long now) {
  if (!lcdTestSequenceActive) return false;
  if (lcdTestStepUntilMs == 0 || now >= lcdTestStepUntilMs) {
    lcdTestStep++;
    lcdTestStepUntilMs = now + 1200;
    lcdForceRedraw = true;
  }

  switch (lcdTestStep) {
    case 1:
      lcdSetLines("SMART ELEVATOR", "ESP32-S3 SYSTEM", "INIT...", "CHECKING MODULES");
      return true;
    case 2:
      lcdSetLines("F:0 T:3 UP", "State:MOVING R1", "D:CLOSED RF:OK", "T32C V.12 L120");
      return true;
    case 3:
      lcdSetLines("WARNING", "High Vibration", "V:.72g", "Check Motor");
      return true;
    case 4:
      lcdSetLines("!!! ERROR !!!", "MOTOR STOPPED", "Reason short", "Press R reset");
      return true;
    default:
      lcdTestSequenceActive = false;
      lcdForceRedraw = true;
      Serial.println("[LCD] screen test complete");
      return false;
  }
}

void updateLCD() {
  if (!lcdReady) return;

  unsigned long now = millis();
  if (!lcdForceRedraw && now - lastLcdUpdateMs < LCD_UPDATE_INTERVAL_MS) return;
  lastLcdUpdateMs = now;

  if (inFaultState()) {
    lcdTestSequenceActive = false;
    lcdShowError();
    return;
  }

#if !LCD_UPDATE_WHILE_MOVING
  if (isMovingState()) return;
#endif

  if (lcdRenderTestSequence(now)) return;

  if (lcdStartupUntilMs != 0 && now < lcdStartupUntilMs) {
    lcdSetLines("SMART ELEVATOR", "ESP32-S3 SYSTEM", "INIT...", "CHECKING MODULES");
    return;
  }
  lcdStartupUntilMs = 0;

  if (lcdTemporaryUntilMs != 0 && now < lcdTemporaryUntilMs) {
    lcdSetLines(lcdTemporaryLines[0], lcdTemporaryLines[1], lcdTemporaryLines[2], lcdTemporaryLines[3]);
    return;
  }
  lcdTemporaryUntilMs = 0;

  if (warningAlertConfirmed || adcSafetyFaultConfirmed) {
    lcdShowWarning();
    return;
  }

  if (isMovingState()) {
    lcdShowMoving();
  } else if (state == ST_DOOR_OPENING || state == ST_DOOR_OPEN_WAIT || state == ST_DOOR_CLOSING || state == ST_ARRIVED) {
    lcdShowDoor();
  } else {
    lcdShowNormal();
  }
}


// =====================================================
// MQTT TELEMETRY PUBLISH  (Eclipse Ditto envelope, unchanged shape)
// =====================================================
void publishRequestQueueFeature(JsonObject value) {
  JsonObject queue = value.createNestedObject("request_queue").createNestedObject("properties");
  queue["pending_count"] = pendingRequestCount();
  queue["dispatch_direction"] = dispatchDirection > 0 ? "UP" : dispatchDirection < 0 ? "DOWN"
                                                                                     : "IDLE";
  queue["current_floor"] = currentFloor;
  queue["target_floor"] = (targetFloor >= 0) ? targetFloor : currentFloor;
  queue["priority_active"] = priorityServiceActive && millis() < priorityUntilMs;
  queue["priority_floor"] = isValidFloor(priorityFloor) ? priorityFloor : -1;
  queue["priority_source"] = prioritySource;
  queue["updated_ms"] = millis();

  JsonArray cabin = queue.createNestedArray("cabin");
  JsonArray hallUp = queue.createNestedArray("hall_up");
  JsonArray hallDown = queue.createNestedArray("hall_down");
  for (int floor = 0; floor < NUM_FLOORS; floor++) {
    cabin.add(cabinRequests[floor]);
    hallUp.add(hallUpRequests[floor]);
    hallDown.add(hallDownRequests[floor]);
  }
}

void publishTelemetry() {
  if (!mqttClient.connected()) return;

#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  StaticJsonDocument<JSON_DOC_CAPACITY> doc;
#endif

  doc["topic"] = "building/floor1:elevator/things/twin/commands/modify";
  doc["headers"]["content-type"] = "application/json";
  doc["path"] = "/features";

  JsonObject value = doc.createNestedObject("value");

  JsonObject cabin = value.createNestedObject("cabin").createNestedObject("properties");
  cabin["current_floor"] = currentFloor;
  cabin["target_floor"] = (targetFloor >= 0) ? targetFloor : currentFloor;
  cabin["direction"] = twinDirection();
  cabin["speed_ms"] = twinSpeedMs();
  cabin["emergency_stop"] = inFaultState();
  cabin["trips_today"] = tripsToday;
  cabin["load_kg"] = simulatedLoadKg;
  cabin["temperature_c"] = simulatedCabinTemperatureC;
  cabin["load_adc_raw"] = simLoadRaw;
  cabin["overload"] = simulatedLoadKg >= SIM_LOAD_RATED_KG;
  cabin["movement_locked"] = adcSafetyMovementBlocked();
  cabin["lockout_reason"] = adcMovementLockoutNowReason() ? adcMovementLockoutNowReason() : "NONE";

  publishRequestQueueFeature(value);

  JsonObject door = value.createNestedObject("door").createNestedObject("properties");
  door["state"] = twinDoorState();
  door["cycle_count"] = doorCycleCount;

  JsonObject motor = value.createNestedObject("motor").createNestedObject("properties");
  motor["health_status"] = twinMotorHealth();
  motor["temperature_c"] = simulatedTemperatureC;
  motor["vibration_level"] = simulatedVibrationG;
  motor["temperature_adc_raw"] = simTempRaw;
  motor["vibration_adc_raw"] = simVibRaw;
  motor["temperature_warning"] = simulatedTemperatureC >= SIM_TEMP_WARNING_C;
  motor["vibration_warning"] = simulatedVibrationG >= SIM_VIB_WARNING_G;
  motor["safety_interlock"] = adcSafetyFaultConfirmed;
  motor["safety_reason"] = adcSafetyFaultReason;
  motor["movement_lockout_reason"] = adcMovementLockoutNowReason() ? adcMovementLockoutNowReason() : "NONE";

  JsonObject fan = value.createNestedObject("fan").createNestedObject("properties");
  fan["state"] = fanHardwareRequestedOn ? "ON" : "OFF";
  fan["mode"] = (fanMode == FAN_MODE_MANUAL) ? "MANUAL" : "AUTO";
  fan["reason"] = fanReason ? fanReason : "IDLE";
  fan["runtime_today_min"] = fanRuntimeMs() / 60000.0f;

  JsonObject security = value.createNestedObject("security").createNestedObject("properties");
  security["rfid_enabled"] = ENABLE_RFID ? true : false;
  security["rfid_ready"] = rfidReady;
  security["rfid_fault"] = rfidModuleFault;
  security["rfid_status"] = rfidStateLabel();
  security["rfid_role"] = lastRfidRole;
  security["rfid_uid"] = lastRfidUid;
  security["rfid_uid_short"] = lastRfidUid;
  security["rfid_authorized"] = lastRfidAuthorized;
  security["rfid_reason"] = lastRfidReason;
  security["rfid_session_active"] = rfidSessionActive();
  security["rfid_session_user"] = activeRfidUserName;
  security["rfid_session_role"] = activeRfidRoleName;
  security["rfid_session_uid"] = activeRfidUid;
  security["rfid_session_expires_ms"] = activeRfidSessionUntilMs;
  security["rfid_floor_mask"] = activeRfidFloorMask;
  security["rfid_restricted_floor_mask"] = RFID_RESTRICTED_FLOOR_MASK;
  security["rfid_priority_active"] = priorityServiceActive && millis() < priorityUntilMs;
  security["rfid_priority_floor"] = isValidFloor(priorityFloor) ? priorityFloor : -1;
  security["rfid_priority_source"] = prioritySource;
  security["rfid_granted_count"] = rfidGrantedCount;
  security["rfid_denied_count"] = rfidDeniedCount;
  security["rfid_unknown_count"] = rfidUnknownCount;
  security["rfid_revoked_count"] = rfidRevokedCount;
  security["rfid_floor_denied_count"] = rfidRestrictedDeniedCount;
  security["rfid_vip_service_count"] = rfidVipServiceCount;
  security["locked"] = securityLocked;
  security["cabin_auth_required"] = RFID_REQUIRE_AUTH_FOR_CABIN_CALLS;
  security["hall_auth_required"] = RFID_REQUIRE_AUTH_FOR_HALL_CALLS;
  security["degrade_open"] = RFID_CABIN_DEGRADE_OPEN;
  security["awaiting_auth"] = hasPendingAuth();
  security["pending_floor"] = firstPendingAuthFloor();

  // Static (not stack) to avoid a multi-KB allocation on the ~8 KB loop task.
  // Safe because publishTelemetry() only runs from the single-threaded loop.
  static char payload[JSON_DOC_CAPACITY];
  size_t len = serializeJson(doc, payload, sizeof(payload));
  if (mqttClient.publish(MQTT_TELEMETRY_TOPIC, payload)) {
    Serial.print("[MQTT] tx ");
    Serial.print(len);
    Serial.print("B state=");
    Serial.println(stateName(state));
  } else {
    Serial.println("[MQTT] publish FAILED");
  }
}

void publishMqttOnlineStatus(bool force) {
  if (!mqttClient.connected()) return;

  unsigned long now = millis();
  if (!force && (now - lastMqttStatusMs < MQTT_STATUS_PUBLISH_MS)) return;

  if (mqttClient.publish(MQTT_STATUS_TOPIC, "{\"status\":\"online\"}", true)) {
    lastMqttStatusMs = now;
  } else {
    Serial.println("[MQTT] status publish FAILED");
  }
}

#if PUBLISH_POSITION_WHILE_MOVING
// H1: compact cabin-only position update for use DURING motion. Uses the
// partial Ditto path /features/cabin/properties, which the MQTT->Ditto bridge
// already normalizes, so no dashboard/bridge change is required. Kept small and
// called only at discrete events (trip start, floor-boundary crossings).
void publishMovingPosition() {
  if (!mqttClient.connected()) return;

#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  StaticJsonDocument<256> doc;
#endif
  doc["topic"] = "building/floor1:elevator/things/twin/commands/modify";
  doc["headers"]["content-type"] = "application/json";
  doc["path"] = "/features/cabin/properties";

  JsonObject value = doc.createNestedObject("value");
  value["current_floor"] = currentFloor;
  value["target_floor"] = (targetFloor >= 0) ? targetFloor : currentFloor;
  value["direction"] = twinDirection();
  value["speed_ms"] = twinSpeedMs();

  static char buf[256];
  serializeJson(doc, buf, sizeof(buf));
  mqttClient.publish(MQTT_TELEMETRY_TOPIC, buf);
}
#endif


// =====================================================
// MQTT COMMAND HANDLING
// =====================================================
void handleDeviceDiagnosticCommand(const char* action, const char* source) {
  if (!action || action[0] == '\0') {
    Serial.println("[MQTT][DIAG] ignored: missing action");
    return;
  }

  if (!strcmp(action, "LCD_I2C_SCAN")) {
    lcdScanI2CBus();
  } else if (!strcmp(action, "LCD_SAFE_PIN_SCAN")) {
    lcdScanSafeI2CPinPairs();
  } else if (!strcmp(action, "LCD_REINIT")) {
    if (isMovingState()) {
      Serial.println("[LCD] reinit skipped while moving to protect step timing");
      return;
    }
    Serial.println("[LCD] reinitializing LCD HMI");
    setupLCD();
    updateLCD();
  } else if (!strcmp(action, "LCD_CLEAR")) {
    if (!lcdReady) {
      Serial.println("[LCD] clear skipped: LCD not ready / I2C backpack not detected");
      return;
    }
    if (isMovingState()) {
      Serial.println("[LCD] clear skipped while moving to protect step timing");
      return;
    }
    for (uint8_t row = 0; row < LCD_ROWS; row++) lcdClearLine(row);
    lcdForceRedraw = true;
    Serial.println("[LCD] cleared");
  } else if (!strcmp(action, "LCD_PRINT_CONFIG")) {
    printLcdConfiguration();
  } else if (!strcmp(action, "LCD_TEST")) {
    runLcdScreenTest();
  } else if (!strcmp(action, "RFID_TEST_GRANTED")) {
    recordRfidEvent(true, "ADMIN", "DEMO1234", source);
  } else if (!strcmp(action, "RFID_TEST_DENIED")) {
    recordRfidEvent(false, "UNKNOWN", "BADCAFE", "UNKNOWN CARD");
  } else if (!strcmp(action, "RFID_TEST_VIP")) {
    processRfidUid("A1B2C3D4");
  } else if (!strcmp(action, "RFID_STATUS")) {
    printRfidStatus();
  } else if (!strcmp(action, "RFID_CLEAR_SESSION")) {
    clearRfidSession("MQTT DIAG");
    priorityServiceActive = false;
    priorityFloor = -1;
    copyBounded(prioritySource, sizeof(prioritySource), "NONE");
    priorityUntilMs = 0;
    Serial.println("[MQTT][DIAG] RFID session and priority cleared");
  } else if (!strcmp(action, "BUZZER_TEST")) {
    requestBuzzerPattern(BUZZ_PATTERN_BUTTON);
    Serial.println("[MQTT][DIAG] buzzer test: normal button beep");
  } else if (!strcmp(action, "BUZZER_GPIO_HIGH")) {
    startBuzzerRawLevelTest(true);
  } else if (!strcmp(action, "BUZZER_GPIO_LOW")) {
    startBuzzerRawLevelTest(false);
  } else if (!strcmp(action, "BUZZER_RELEASE")) {
    buzzerReleasePin();
    Serial.println("[MQTT][DIAG] buzzer GPIO released/off");
  } else if (!strcmp(action, "BUZZER_WARNING")) {
    requestBuzzerPattern(BUZZ_PATTERN_WARNING_TEST);
    Serial.println("[MQTT][DIAG] warning alert test");
  } else if (!strcmp(action, "FAN_GPIO_HIGH")) {
    fanForceOutputHighDiagnostic();
  } else if (!strcmp(action, "FAN_GPIO_LOW")) {
    fanForceOutputLowDiagnostic();
  } else if (!strcmp(action, "FAN_GPIO_INPUT")) {
    fanForceInputDiagnostic(false);
  } else if (!strcmp(action, "FAN_GPIO_PULLUP")) {
    fanForceInputDiagnostic(true);
  } else {
    Serial.print("[MQTT][DIAG] unknown action: ");
    Serial.println(action);
  }

  publishNow = true;
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  // Fixed buffer instead of Arduino String to avoid per-message heap
  // allocation/fragmentation over long uptime. Commands are tiny; an
  // oversized payload is safely truncated rather than growing the heap.
  static char body[384];
  unsigned int n = (length < sizeof(body) - 1) ? length : (unsigned int)(sizeof(body) - 1);
  memcpy(body, payload, n);
  body[n] = '\0';

  // Trim leading/trailing ASCII whitespace in place.
  char* msg = body;
  while (*msg == ' ' || *msg == '\t' || *msg == '\r' || *msg == '\n') msg++;
  size_t mlen = strlen(msg);
  while (mlen > 0) {
    char c = msg[mlen - 1];
    if (c == ' ' || c == '\t' || c == '\r' || c == '\n') msg[--mlen] = '\0';
    else break;
  }

  Serial.print("[MQTT] cmd: ");
  Serial.println(msg);

  // Bare floor number shortcut.
  if (mlen == 1 && msg[0] >= '0' && msg[0] <= '3') {
    handleFloorRequest(msg[0] - '0', "MQTT");
    return;
  }

#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument cmd;
#else
  StaticJsonDocument<256> cmd;
#endif
  DeserializationError err = deserializeJson(cmd, msg);
  if (err) {
    Serial.print("[MQTT] parse error: ");
    Serial.println(err.c_str());
    return;
  }

  const char* command = cmd["command"] | "";

  if (!strcmp(command, "MOVE_TO_FLOOR") || !strcmp(command, "CALL")) {
    if (cmd["target_floor"].is<int>()) {
      handleFloorRequest(cmd["target_floor"].as<int>(), "MQTT");
    } else {
      Serial.println("[MQTT] MOVE_TO_FLOOR ignored: missing target_floor");
    }
  } else if (!strcmp(command, "EMERGENCY_STOP")) {
    enterEmergency("Emergency stop from MQTT.");
  } else if (!strcmp(command, "SOFT_STOP")) {
    enterErrorStop("Soft stop from MQTT.");
  } else if (!strcmp(command, "FRESH_START")
             || !strcmp(command, "RESET_ALL")
             || !strcmp(command, "FACTORY_RESET")) {
    resetRuntimeState("MQTT");
  } else if (!strcmp(command, "RESET") || !strcmp(command, "CLEAR_EMERGENCY")) {
    clearEmergencyAndResume("MQTT");
  } else if (!strcmp(command, "REQUEST_STATUS_REFRESH")
             || !strcmp(command, "STATUS_REFRESH")
             || !strcmp(command, "DUMP_REQUEST_TABLE")) {
    dumpRequestTable();
    publishNow = true;
  } else if (!strcmp(command, "HOME")) {
    currentFloor = START_FLOOR;
    targetFloor = -1;
    segmentTargetFloor = -1;
    dispatchDirection = 0;
    stepsToDeliver = stepsDelivered = 0;
    stepsSinceLastBoundary = 0;
    resumePendingMove = false;
    resumeTargetFloor = -1;
    resumeSegmentTargetFloor = -1;
    resumeStepsRemaining = 0;
    resumeStepsSinceLastBoundary = 0;
    requestTableClear();
    setFaultReason("NONE");
    transitionTo(ST_IDLE);
    lcdShowMessageTemporary("HOME SET", "Floor calibrated", "Current floor 0", "System ready", LCD_TEMP_MESSAGE_DURATION_MS);
    Serial.println("[MQTT] HOME");
  } else if (!strcmp(command, "SET_FAN")
             || !strcmp(command, "FAN_ON")
             || !strcmp(command, "FAN_OFF")
             || !strcmp(command, "FAN_AUTO")) {
    const char* reqState = cmd["fan_state"] | "";
    const char* reqMode = cmd["fan_mode"] | "";
    if (!strcmp(command, "FAN_AUTO") || !strcmp(reqMode, "AUTO")) {
      fanMode = FAN_MODE_AUTO;
      updateFanAuto();
      Serial.println("[FAN] -> AUTO");
    } else {
      bool desiredOn;
      if (!strcmp(command, "FAN_ON")) desiredOn = true;
      else if (!strcmp(command, "FAN_OFF")) desiredOn = false;
      else desiredOn = !strcmp(reqState, "ON");
      fanMode = FAN_MODE_MANUAL;
      fanManualState = desiredOn;
      setFanState(desiredOn, "OPERATOR_OVERRIDE");
      Serial.print("[FAN] -> MANUAL ");
      Serial.println(desiredOn ? "ON" : "OFF");
    }
    publishNow = true;
  } else if (!strcmp(command, "SECURITY_LOCK") || !strcmp(command, "LOCKDOWN")) {
    setSecurityLockdown(true, "MQTT");
  } else if (!strcmp(command, "SECURITY_UNLOCK") || !strcmp(command, "UNLOCK")) {
    setSecurityLockdown(false, "MQTT");
  } else if (!strcmp(command, "DEVICE_DIAGNOSTIC")) {
    const char* action = cmd["device_action"] | "";
    if (!action || action[0] == '\0') action = cmd["action"] | "";
    handleDeviceDiagnosticCommand(action, "MQTT DIAG");
  } else {
    Serial.print("[MQTT] unknown command: ");
    Serial.println(command);
  }
}


// =====================================================
// CONNECTIVITY  (non-blocking, stepper-safe)
// =====================================================
void setupWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WIFI] connecting to ");
  Serial.print(WIFI_SSID);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(400);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print(" OK IP=");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println(" not connected (background retry)");
  }
}

// Human-readable PubSubClient state()/rc codes, so a serial reader can tell a
// TCP/TLS transport failure (rc=-2) apart from an auth/ACL rejection (rc=5) etc.
const char* mqttStateText(int s) {
  switch (s) {
    case -4: return "CONNECTION_TIMEOUT: broker not responding";
    case -3: return "CONNECTION_LOST: network dropped mid-connection";
    case -2: return "CONNECT_FAILED: TCP/TLS handshake failed (port/firewall/cert/time)";
    case -1: return "DISCONNECTED: clean disconnect";
    case 0:  return "CONNECTED";
    case 1:  return "BAD_PROTOCOL";
    case 2:  return "BAD_CLIENT_ID";
    case 3:  return "SERVER_UNAVAILABLE";
    case 4:  return "BAD_CREDENTIALS: username/password rejected";
    case 5:  return "NOT_AUTHORIZED: auth/ACL denied this client";
    default: return "UNKNOWN";
  }
}

void tryMqttConnect() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (mqttClient.connected()) return;

  Serial.print("[MQTT] connect ");
  Serial.print(MQTT_SERVER);
  Serial.print(":");
  Serial.print(MQTT_PORT);
  Serial.print(" ... ");

  String clientId = "elevator-esp32-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  // Use broker auth when a username is configured (via secrets.h); otherwise
  // fall back to the anonymous connect this firmware has always used.
  bool useAuth = (MQTT_USERNAME != nullptr && MQTT_USERNAME[0] != '\0');
  bool ok = useAuth
              ? mqttClient.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD,
                                   MQTT_STATUS_TOPIC, 0, true, "{\"status\":\"offline\"}")
              : mqttClient.connect(clientId.c_str(),
                                   MQTT_STATUS_TOPIC, 0, true, "{\"status\":\"offline\"}");
  if (ok) {
    Serial.println("OK");
    publishMqttOnlineStatus(true);
    mqttClient.subscribe(MQTT_COMMANDS_TOPIC);
    publishNow = true;
  } else {
    int st = mqttClient.state();
    Serial.print("FAIL rc=");
    Serial.print(st);
    Serial.print(" (");
    Serial.print(mqttStateText(st));
    Serial.println(")");
#if MQTT_USE_TLS
    {
      char tlsErr[128];
      int rc = espClient.lastError(tlsErr, sizeof(tlsErr));
      if (rc != 0) {
        Serial.print("[MQTT][TLS] last handshake error ");
        Serial.print(rc);
        Serial.print(": ");
        Serial.println(tlsErr);
      }
      time_t nowSec = time(nullptr);
      Serial.print("[MQTT][TLS] device UTC epoch=");
      Serial.print((uint32_t)nowSec);
      if (nowSec < 1700000000UL) {
        Serial.println(" <-- clock NOT set; cert validity WILL fail (fix NTP/time)");
      } else {
        Serial.println(" (inside cert window)");
        Serial.println("[MQTT][TLS] rc=-2 with a good clock usually means the broker cert SAN");
        Serial.println("            lacks this MQTT_SERVER IP -> run scripts/reissue-server-cert.sh");
      }
    }
#endif
  }
}

// V6: while MOVING_UP/DOWN, skip the slow telemetry publish and the
// connect attempt. mqttClient.loop() STILL runs so inbound commands
// (EMERGENCY_STOP, RESET) are honoured during travel.
void serviceMqtt() {
  bool moving = isMovingState();

  if (!mqttClient.connected() && !moving) {
    if (millis() - lastMqttRetryMs >= MQTT_RETRY_MS) {
      lastMqttRetryMs = millis();
      tryMqttConnect();
    }
  }

  if (mqttClient.connected()) {
    mqttClient.loop();  // keepalive + inbound dispatch (fast)
    publishMqttOnlineStatus(false);

    if (!moving) {  // <-- publish only when NOT moving
      bool periodic = (millis() - lastPublishMs >= PUBLISH_INTERVAL_MS);
      if (periodic || publishNow) {
        lastPublishMs = millis();
        publishNow = false;
        publishTelemetry();
      }
    }
  }
}


// =====================================================
// PERIODIC COMPACT STATUS
// V6: skipped while MOVING so Serial.print does not stall the stepper.
// =====================================================
void printStatusPeriodic() {
  if (isMovingState()) return;

  static unsigned long lastPrint = 0;
  if (millis() - lastPrint < 2000) return;
  lastPrint = millis();

  Serial.print("[STATUS] ");
  Serial.print(stateName(state));
  Serial.print(" F=");
  Serial.print(currentFloor);
  Serial.print("->");
  Serial.print((targetFloor >= 0) ? targetFloor : currentFloor);
  Serial.print(" R=");
  Serial.print(pendingRequestCount());
  Serial.print(" Fan=");
  Serial.print(fanHardwareRequestedOn ? "ON" : "OFF");
  Serial.print("/");
  Serial.print(fanMode == FAN_MODE_MANUAL ? "MAN" : "AUTO");
  Serial.print(" WiFi=");
  Serial.print(WiFi.status() == WL_CONNECTED ? "OK" : "--");
  Serial.print(" MQTT=");
  Serial.print(mqttClient.connected() ? "OK" : "--");
  Serial.println();
}


// =====================================================
// SETUP
// =====================================================
void setup() {
  // Relay OFF before anything else so a power-up glitch can't kick the fan.
  fanHardwareOff();

  Serial.begin(115200);
  delay(500);

  Serial.println();
  Serial.println("============================================");
  Serial.println(" ESP32-S3 Smart Elevator  V6  (step-count)  ");
  Serial.println(" Step-based arrival | MQTT gated in MOVING  ");
  Serial.println(" MQTT -> Eclipse Ditto -> SCADA dashboard   ");
  Serial.println("============================================");
  Serial.print("Floors                 : ");
  Serial.println(NUM_FLOORS);
  Serial.print("STEPS_PER_FLOOR        : ");
  Serial.println(STEPS_PER_FLOOR);
  Serial.print("STEP_ACCEL_STEPS       : ");
  Serial.println(STEP_ACCEL_STEPS);
  Serial.print("STEP_DECEL_STEPS       : ");
  Serial.println(STEP_DECEL_STEPS);
  Serial.print("STEP_DELAY_FAST_US     : ");
  Serial.println(STEP_DELAY_FAST_US);
  Serial.print("STEP_DELAY_SLOW_US     : ");
  Serial.println(STEP_DELAY_SLOW_US);
  Serial.print("MAX_FLOOR_TRAVEL_MS    : ");
  Serial.println(MAX_FLOOR_TRAVEL_MS);
  Serial.print("Door pulse / dwell ms  : ");
  Serial.print(DOOR_PULSE_MS);
  Serial.print(" / ");
  Serial.println(DOOR_DWELL_MS);
  Serial.print("DOOR_INVERT            : ");
  Serial.println(DOOR_INVERT ? "true" : "false");
  Serial.print("DIR_UP_ACTIVE_LOW      : ");
  Serial.println(DIR_UP_ACTIVE_LOW ? "true" : "false");
  Serial.print("EMERGENCY_STOP_PIN     : ");
  Serial.println(EMERGENCY_STOP_PIN);
  Serial.println("Dispatch logic         : collective selective control");
  Serial.print("Fan relay GPIO         : ");
  Serial.println(FAN_RELAY_PIN);
  Serial.println(FAN_RELAY_ACTIVE_LOW ? "Fan relay logic        : active LOW" : "Fan relay logic        : active HIGH");
  Serial.println("Fan OFF method         : INPUT/high-Z");
  Serial.print("Fan startup state      : ");
  Serial.print(fanHardwareRequestedOn ? "ON" : "OFF");
  Serial.print("/");
  Serial.println(fanMode == FAN_MODE_MANUAL ? "MANUAL" : "AUTO");
  Serial.print("Buzzer GPIO            : ");
  Serial.println(BUZZER_PIN);
  Serial.println("Buzzer mode            : direct GPIO low-side sink");
  Serial.print("Buzzer wiring          : + to 3V3, - to GPIO");
  Serial.println(BUZZER_PIN);
  Serial.print("Buzzer ON/OFF levels   : ");
  Serial.print(BUZZER_ACTIVE_HIGH ? "HIGH/LOW" : "LOW/HIGH");
  Serial.println(BUZZER_OFF_USES_INPUT_PULLUP ? " with INPUT_PULLUP off" : "");
  Serial.print("ADC safety interlock   : ");
  Serial.println(ENABLE_ADC_SAFETY_INTERLOCK ? "ENABLED" : "DISABLED");
  Serial.print("ADC safety confirm ms  : ");
  Serial.println(ADC_SAFETY_FAULT_CONFIRM_MS);
  Serial.print("LCD HMI                : ");
  Serial.println(ENABLE_LCD ? "ENABLED" : "DISABLED");
  Serial.print("LCD SDA/SCL GPIO       : ");
  Serial.print(LCD_SDA_PIN);
  Serial.print(" / ");
  Serial.println(LCD_SCL_PIN);
  Serial.print("LCD configured address : 0x");
  Serial.println(LCD_I2C_ADDRESS, HEX);
  Serial.print("RFID reader            : ");
  Serial.println(ENABLE_RFID ? "ENABLED" : "DISABLED");
#if ENABLE_RFID
  Serial.print("RFID SS/RST GPIO       : ");
  Serial.print(RFID_SS_PIN);
  Serial.print(" / ");
  Serial.println(RFID_RST_PIN);
  Serial.print("RFID SCK/MISO/MOSI     : ");
  Serial.print(RFID_SCK_PIN);
  Serial.print(" / ");
  Serial.print(RFID_MISO_PIN);
  Serial.print(" / ");
  Serial.println(RFID_MOSI_PIN);
#endif

  setupLCD();

  Serial.println("[SETUP] configuring stepper and door GPIO...");
  pinMode(STEP_PIN, INPUT);
  pinMode(DIR_PIN, INPUT);
  pinMode(DOOR_IN1_PIN, OUTPUT);
  pinMode(DOOR_IN2_PIN, OUTPUT);
  pinMode(DOOR_EN_PIN, OUTPUT);
  doorStop();
  Serial.println("[SETUP] stepper and door GPIO ready");

  Serial.println("[SETUP] configuring button inputs...");
  for (int i = 0; i < NUM_BUTTONS; i++) {
    pinMode(buttons[i].pin, INPUT_PULLUP);
    buttons[i].lastReading = digitalRead(buttons[i].pin);
    buttons[i].stableState = buttons[i].lastReading;
  }
  Serial.println("[SETUP] button inputs ready");

  if (EMERGENCY_STOP_PIN >= 0) {
    pinMode(EMERGENCY_STOP_PIN, INPUT_PULLUP);
    Serial.println("[SETUP] emergency input ready");
  }

  setupBuzzer();
  setupRFID();
  setupSimulatedTelemetryAdc();

  resetRuntimeState("BOOT");

  setupWifi();

#if MQTT_USE_TLS
  // TLS certificate validity (notBefore/notAfter) requires a real wall clock,
  // so sync time via NTP before the first secure connect, then pin the CA.
  // Primary = the PC/broker host (local NTP server on the isolated LAN); then the
  // router gateway; then public NTP (only reachable if the LAN gains internet).
  configTime(0, 0, SECRET_NTP_SERVER, NTP_SERVER_GATEWAY, NTP_SERVER_PUBLIC);
  {
    Serial.print("[TIME] NTP sync (");
    Serial.print(SECRET_NTP_SERVER);
    Serial.print(" -> ");
    Serial.print(NTP_SERVER_GATEWAY);
    Serial.print(" -> ");
    Serial.print(NTP_SERVER_PUBLIC);
    Serial.print(") ");
    time_t nowSec = time(nullptr);
    unsigned long t0 = millis();
    // 1700000000 ~= 2023-11; anything below means the clock isn't set yet.
    while (nowSec < 1700000000UL && millis() - t0 < 8000) {
      delay(200);
      Serial.print(".");
      nowSec = time(nullptr);
    }
    if (nowSec < 1700000000UL) {
      // NTP unreachable (no internet on the elevator LAN). Set the fixed
      // fallback clock so the pinned broker cert still passes its validity
      // window and TLS can complete; NTP will refine the clock later if it
      // becomes reachable.
      struct timeval tv;
      tv.tv_sec = (time_t)TLS_TIME_FALLBACK_EPOCH;
      tv.tv_usec = 0;
      settimeofday(&tv, nullptr);
      nowSec = time(nullptr);
      Serial.print(" NTP unreachable -> fallback clock ");
    } else {
      Serial.print(" ok ");
    }
    struct tm tmUtc;
    gmtime_r(&nowSec, &tmUtc);
    char tbuf[32];
    strftime(tbuf, sizeof(tbuf), "%Y-%m-%dT%H:%M:%SZ", &tmUtc);
    Serial.println(tbuf);  // the UTC clock TLS will actually use
  }
  espClient.setCACert(MQTT_CA_CERT);
  Serial.println("[MQTT] TLS enabled: port 8883, server CA pinned");
#endif

  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setCallback(onMqttMessage);
  mqttClient.setKeepAlive(MQTT_KEEPALIVE_SECONDS);
  mqttClient.setSocketTimeout(MQTT_SOCKET_TIMEOUT_SECONDS);
  mqttClient.setBufferSize(JSON_DOC_CAPACITY);
  tryMqttConnect();

  Serial.println();
  Serial.println("Serial commands:");
  Serial.println("  0..3  request floor");
  Serial.println("  Q     dump request table");
  Serial.println("  S     soft stop  -> ERROR_STOP");
  Serial.println("  E     emergency -> EMERGENCY");
  Serial.println("  R     reset to IDLE (current floor kept)");
  Serial.println("  H     home (current floor = START_FLOOR)");
  Serial.println("  x     fresh start reset (clear requests/counters/timers)");
  Serial.println("  I     scan I2C bus for LCD address");
  Serial.println("  J     scan safe alternate LCD I2C pin pairs");
  Serial.println("  K     reinitialize LCD after wiring/address fix");
  Serial.println("  C     clear LCD");
  Serial.println("  D     print LCD configuration");
  Serial.println("  L     test LCD screens (non-blocking)");
  Serial.println("  G/g   RFID LCD test: granted / denied event");
  Serial.println("  P     print RFID/security status");
  Serial.println("  B     test buzzer normal beep");
  Serial.println("  T     force buzzer GPIO HIGH for 2 s");
  Serial.println("  t     force buzzer GPIO LOW for 2 s (direct mode ON)");
  Serial.println("  N     release buzzer GPIO / stop test");
  Serial.println("  W     test warning beep");
  Serial.println("  F     fan manual ON  (relay active LOW)");
  Serial.println("  f     fan manual OFF (GPIO INPUT/high-Z)");
  Serial.println("  U/u   fan GPIO diag HIGH / LOW");
  Serial.println("  Z/z   fan GPIO diag INPUT / INPUT_PULLUP");
  Serial.println("  a     fan AUTO mode");
  Serial.print("Telemetry topic : ");
  Serial.println(MQTT_TELEMETRY_TOPIC);
  Serial.print("Commands topic  : ");
  Serial.println(MQTT_COMMANDS_TOPIC);
  Serial.println();
  Serial.println("Calibration tip: send the cabin 0 -> 1, measure overshoot/");
  Serial.println("undershoot, then scale STEPS_PER_FLOOR until the trip lands");
  Serial.println("on the floor mark. The [CALIB] line after each arrival shows");
  Serial.println("the number of step pulses actually delivered.");
  Serial.println();
  Serial.println("Ready.");
  updateLCD();
}


// =====================================================
// LOOP
// =====================================================
void loop() {
  handleSerialCommands();
  checkEmergencyStopInput();
  serviceRFID();
  readButtons();
  updateSimulatedTelemetry();
  updateWarningAlertState();
  updateAdcSafetyInterlock();
  updateBuzzer();
  updateFanAuto();
  serviceMqtt();
  printStatusPeriodic();

  switch (state) {
    case ST_DOOR_OPENING: tickDoorOpening(); break;
    case ST_DOOR_OPEN_WAIT: tickDoorOpenWait(); break;
    case ST_DOOR_CLOSING: tickDoorClosing(); break;
    case ST_MOVING_UP:
    case ST_MOVING_DOWN: tickMoving(); break;
    case ST_ARRIVED: tickArrived(); break;
    case ST_IDLE: dispatchNextRequest(); break;
    case ST_ERROR_STOP:
    case ST_EMERGENCY:
      stopStepper();
      doorStop();
      break;
  }

  updateLCD();
}
