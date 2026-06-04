# Smart Elevator Digital Twin Project Context

Generated from workspace inspection on 2026-05-24.

This document captures the current technical context for the smart and secure elevator prototype and its Digital Twin platform. It is intended for future coding prompts, debugging, thesis documentation, and integration planning.

## 1. Project Overview

The project is a smart and secure 4-floor elevator prototype controlled by an ESP32-S3 board and integrated into a larger Agentic AI-driven Digital Twin platform.

Target architecture:

```text
ESP32-S3 firmware -> MQTT -> bridge / n8n -> Eclipse Ditto -> Next.js SCADA dashboard
Dashboard commands -> safety gate -> Ditto desired state -> MQTT command topic -> ESP32-S3
```

Current physical prototype context:

- Controller: ESP32-S3 N16R8 / 44-pin board.
- Vertical motion: NEMA17 stepper motor through a MicrostepDriver using PUL and DIR.
- Door actuator: small DC motor from a desktop disk opener/closer mechanism through L298N/HW-095.
- Calls: 6 outside hall-call buttons and 4 cabin buttons for floors 0, 1, 2, 3.
- Cooling: fan controlled through a JQC3F-05VDC-C relay module.
- Simulated sensors: 3x 10K potentiometers for temperature, vibration, and load.
- Alerts: buzzer rated 3-24 V DC.
- Access control: RC522/MFRC522 RFID reader planned, with only 2 physical cards available.
- Local HMI: LCD 1604A I2C display, 16 columns x 4 rows.
- Not used: LTP-1457AC LED matrix. It should not be integrated.
- Considered but not currently active: HW-484 Hall sensors for floor feedback.
- Power: ATX supply for 12 V motors and 5 V electronics, with common GND shared with ESP32 and modules.

## 2. Repository Overview

Important workspace files and directories:

| Path | Role | Current status |
| --- | --- | --- |
| `main_esp_32_code_smart_elevator_v6/main_esp_32_code_smart_elevator_v6.ino` | ESP32-S3 firmware sketch with step-count elevator control, buttons, door motor, fan, simulated ADC telemetry, buzzer, LCD HMI hooks, MQTT/Ditto telemetry, and MQTT commands. | Newest/primary firmware candidate by banner and version naming. |
| `main_esp_32_code_smart_elevator/main_esp_32_code_smart_elevator.ino` | Parallel ESP32-S3 firmware sketch. Functionally close to V6, but hall-call pins differ for F1/F2 up/down. | Active variant because earlier work was mirrored here. Confirm which folder the Arduino IDE opens. |
| `ELEVATOR_SIMULATOR_ESP8266/ELEVATOR_SIMULATOR_ESP8266.ino` | ESP8266-style simulator sketch that publishes Ditto-compatible MQTT telemetry. | Legacy / simulator reference, not the ESP32-S3 physical firmware. |
| `esp32_simulator.py` | Python elevator Digital Twin simulator with physics, anomalies, MQTT publishing, Ditto payloads, and runtime health file. | Main software simulator for platform testing without hardware. |
| `docker-compose.yml` | Local orchestration for Mosquitto, MQTT-to-Ditto bridge, optional simulator, n8n, Postgres/Timescale, optional Ollama, optional tools. | Main local infrastructure entry point. Eclipse Ditto runs in a separate stack. |
| `Dockerfile.bridge` | Container image for `dashboard/backend/bridge.js`. | MQTT-to-Ditto bridge container. |
| `Dockerfile.simulator` | Container image for `esp32_simulator.py`. | Optional simulator profile. |
| `SETUP.md` | Local setup guide for Ditto, Docker services, dashboard, n8n imports, validation, and troubleshooting. | Current operations guide. |
| `.env`, `.env.example` | Environment configuration for Docker services, Ditto, MQTT, n8n, database, local LLM, and dashboard. | `.env` contains local values. Do not publish secrets. |
| `dashboard/` | Next.js SCADA dashboard and server-side APIs. | Main operator UI. |
| `dashboard/backend/bridge.js` | MQTT subscriber and Ditto REST writer. Normalizes payload aliases and updates Ditto features/attributes. | Core ingestion bridge. |
| `dashboard/src/services/dittoApi.js` | Browser-side Ditto API helper using the dashboard proxy. | Used by dashboard state synchronization. |
| `dashboard/src/services/mqttClient.js` | Browser MQTT client over WebSocket. Includes command publish helper. | UI telemetry/status helper. UI should use Ditto as source of truth, not raw MQTT. |
| `dashboard/src/services/commandClient.js` | Browser command helper that posts to `/api/commands` rather than writing Ditto directly. | Correct command entry point. |
| `dashboard/src/lib/commandSafetyGate.js` | Deterministic command admission logic. | Single source of truth for dashboard command safety rules. |
| `dashboard/app/api/commands/route.js` | Server-side command safety endpoint. Loads Ditto twin, validates command, persists audit, writes Ditto, publishes MQTT command. | Trusted command boundary. |
| `dashboard/app/api/ditto/[...path]/route.ts` | Next.js proxy to Ditto with Basic Auth and SSE support. | Used by browser Ditto calls. |
| `dashboard/app/api/history/*` | History endpoints for telemetry, risk, audit, commands, notifications, maintenance, energy, system health. | Reads Postgres/Timescale data. |
| `n8n-workflows/*.json` | Exported n8n workflows: ingestion, analysis, control, security/maintenance, notification, optimization/audit. | Import into n8n manually. |
| `n8n-workflows/enterprise-upgrade-code/*.js` | Code-node logic extracted from workflows: canonicalization, risk engine, safety gate, maintenance, security, notifications, audit. | Useful for review and updates. |
| `postgres/init/*.sql` | Initial database schema and enterprise upgrade schema. | Used by Postgres container init. |
| `postgres/migrations/*.sql` | Later schema migrations including command safety gate support. | Run manually if volume predates changes. |
| `scripts/init-ditto.ps1`, `scripts/init-ditto.sh` | Idempotent Ditto policy and Thing provisioning scripts. | Creates the elevator Thing and expected features. |
| `scripts/validate_mqtt_topics.py` | Static topic convention validator. | Supports MQTT topic hygiene. |
| `scripts/validation/*` | System health, Ditto feature, command safety, and export scripts. | Validation support. |
| `tests/test_simulator.py` | Python unit tests for simulator config, topic builders, physics, payload helpers. | Does not require Docker/MQTT. |
| `tools/*` | n8n upgrade validation/application helpers and bridge start script. | Development tooling. |
| `docs/*` | Architecture, software design, n8n setup, database analytics, safety gate, and validation documents. | Thesis and validation reference. |
| `master-thesis/` | LaTeX thesis source, appendices, figures, and generated build artifacts. | Thesis writing area. |
| `runtime/` | Runtime logs, live simulator twin snapshots, screenshots, browser profiles. | Generated artifacts; do not treat as source. |

Generated/large directories such as `dashboard/node_modules`, `dashboard/.next`, `__pycache__`, and browser profiles under `runtime/` are build/runtime artifacts and should not guide architecture decisions.

## 3. Current ESP32 Firmware Context

There are two ESP32 sketches. The V6 sketch appears to be the newest, while `main_esp_32_code_smart_elevator.ino` is also active and was previously requested for mirrored changes. Keep them synchronized until one is formally retired.

### Firmware Libraries

The current sketches use:

- `WiFi.h`
- `PubSubClient.h`
- `ArduinoJson.h`
- `Wire.h`
- `LiquidCrystal_I2C.h`

The LCD library is an Arduino-compatible `LiquidCrystal_I2C` implementation. The Arduino IDE may show an architecture warning for this library on ESP32; that warning is common for libraries declaring `architectures=*` and is not automatically a compile failure.

### High-Level Architecture

The firmware is a cooperative Arduino loop with these subsystems:

- Elevator state machine.
- Stepper pulse generation for one-floor movement segments.
- Door actuator pulse control through L298N/HW-095.
- Request queue tables for cabin, hall-up, and hall-down calls.
- Debounced button scanning.
- Emergency and error handling.
- Fan relay automatic/manual control.
- Simulated telemetry from ADC potentiometers.
- Buzzer scheduler.
- LCD HMI display layer.
- MQTT telemetry publishing and MQTT command handling.
- Serial Monitor command interface.

### State Machine

Current firmware states:

| State | Meaning |
| --- | --- |
| `ST_IDLE` | No active movement; waits for requests. |
| `ST_DOOR_OPENING` | Door motor is pulsed in open direction. |
| `ST_DOOR_OPEN_WAIT` | Door is considered open; dwell timer running. |
| `ST_DOOR_CLOSING` | Door motor is pulsed in close direction. |
| `ST_MOVING_UP` | Stepper moving upward. |
| `ST_MOVING_DOWN` | Stepper moving downward. |
| `ST_ARRIVED` | Arrival settle phase before door opens. |
| `ST_ERROR_STOP` | Fault state. Motors stopped; reset required. |
| `ST_EMERGENCY` | Emergency stop state. Motion stopped; reset/clear required. |

Movement is blocked in fault states and by configured ADC safety conditions.

### Movement Logic

Current floor positioning is step-count-based, not sensor-based.

Important constants:

- `NUM_FLOORS = 4`
- `START_FLOOR = 0`
- `STEPS_PER_FLOOR = 4500`
- `STEP_DELAY_FAST_US = 900`
- `STEP_DELAY_SLOW_US = 1500`
- `STEP_ACCEL_STEPS = 600`
- `STEP_DECEL_STEPS = 600`
- `MAX_FLOOR_TRAVEL_MS = 10000`

The firmware generates step pulses on `STEP_PIN` and sets direction on `DIR_PIN`. It uses acceleration/deceleration delay shaping by delivered step count.

Important current limitation: the active algorithm moves one floor segment at a time. It sets `segmentTargetFloor = currentFloor + dispatchDirection` and `stepsToDeliver = STEPS_PER_FLOOR`. At each floor boundary it updates `currentFloor`, checks whether a stop is needed, and starts the next segment if not. Because each segment completes before the next begins, the physical motor can slow/stop at every floor even when no request exists there. This is a known algorithmic limitation and matches the observed "slows/stops at every floor" behavior.

The intended future behavior should use continuous multi-floor travel with deceleration only at actual target/stop floors, or should add physical floor sensors and a robust position controller.

### Door Logic

The door actuator is controlled by an L298N/HW-095 H-bridge:

- `DOOR_IN1_PIN`
- `DOOR_IN2_PIN`
- `DOOR_EN_PIN` with PWM

Current behavior:

- Door open pulse duration: `DOOR_PULSE_MS = 505`.
- Door dwell: `DOOR_DWELL_MS = 5000`.
- Arrival settle delay: `ARRIVE_SETTLE_MS = 200`.
- Door speed PWM: `DOOR_SPEED = 200`.
- `DOOR_INVERT` flips open/close polarity in firmware.

There are no door limit switches or obstruction sensors currently wired in the ESP32 firmware. Door state is therefore inferred from timing, not physical feedback.

### Request Handling

The firmware uses separate request tables:

- `cabinRequests[4]`
- `hallUpRequests[4]`
- `hallDownRequests[4]`

Implemented behavior:

- Invalid floors are rejected.
- Endpoint direction buttons are rejected if impossible, such as DOWN at floor 0 or UP at floor 3.
- Duplicate requests are ignored.
- Current-floor requests open or extend the door.
- If a same-floor request arrives while closing, the door reopens.
- When idle, the dispatch direction and next stop are selected from pending requests.
- While moving, compatible same-direction requests ahead are logged as pickup candidates; incompatible/opposite requests remain queued for later.
- `shouldStopAtCurrentFloor()` decides whether the current floor should be served based on cabin requests, matching hall direction, endpoint behavior, and remaining requests.

Missing or incomplete behavior:

- Continuous multi-floor motion is not implemented.
- Fairness/no-starvation is partially implied by request tables but not formally proven.
- Physical floor validation is absent.
- Door-open request extension exists, but there is no real door position feedback.

### Fan Relay Behavior

The fan relay is on `FAN_RELAY_PIN = GPIO16`.

Current logic:

- Relay is treated as active-low.
- Fan ON is driven as GPIO output LOW.
- Fan OFF uses GPIO input/high-Z to avoid unintentionally energizing a sensitive relay module.
- Auto mode turns fan on during motion and for a cooldown after activity.
- Fan can also turn on due to high cabin or motor temperature.
- Critical motor temperature forces fan ON even if manual mode would otherwise turn it off.
- Serial and MQTT can set manual/auto fan mode.

Electrical note: many 5 V relay boards need more current than an ESP32 GPIO can provide directly and may have optocoupler/transistor input quirks. Verify that the relay input is 3.3 V compatible and that common GND is present.

### Buzzer Logic

The firmware has a non-blocking buzzer scheduler on `BUZZER_PIN = GPIO47`.

Pattern constants include:

- startup
- button accepted
- queued request
- arrival
- door
- warning
- warning test
- error

The current code treats the buzzer as a direct GPIO low-side sink with `BUZZER_ACTIVE_HIGH = false` and releases the pin with input pull-up when off. This is acceptable only for a low-current 3.3 V buzzer module. A 3-24 V buzzer powered from 5 V or 12 V should use a transistor/MOSFET driver and should not draw current directly through the ESP32 GPIO.

### Simulated Telemetry

The firmware reads three ADC pins:

- Temperature potentiometer: GPIO4
- Vibration potentiometer: GPIO5
- Load potentiometer: GPIO6

Configured ranges:

- Temperature: 20.0 to 100.0 degC
- Vibration: 0.000 to 0.600 g
- Load: 0 to 1000 kg

Warning/critical thresholds:

- Temperature warning: 70 degC
- Temperature critical: 85 degC
- Vibration warning: 0.120 g
- Vibration critical: 0.250 g
- Rated load: 800 kg

`ENABLE_ADC_SAFETY_INTERLOCK = true`.

Current behavior:

- Load at or above rated load blocks movement.
- Warning temperature/vibration can block movement through the ADC movement lockout path.
- Critical temperature/vibration can enter confirmed fault behavior after a confirmation interval.
- Values are used in Serial output, LCD, fan logic, MQTT telemetry, and risk-related fields.

### RFID Context in Firmware

Current ESP32 firmware does not yet instantiate an MFRC522/RC522 driver and does not assign SPI pins for RFID.

What exists today:

- RFID/security display state variables.
- `recordRfidEvent(...)` helper.
- Serial test commands `G` and `g` to simulate granted/denied LCD/security events.
- MQTT telemetry includes security-oriented fields.

Missing:

- `MFRC522` library integration.
- SPI pin mapping.
- Authorized UID storage for the two available cards.
- Real card read loop.
- Card-to-role and card-to-floor authorization.
- Session timeout logic.
- Event publishing for real scans.

### LCD HMI Context in Firmware

Current LCD config at the top of the sketches:

| Setting | Value |
| --- | --- |
| `ENABLE_LCD` | `1` |
| `LCD_I2C_ADDRESS` | `0x27` |
| `LCD_COLS` | `16` |
| `LCD_ROWS` | `4` |
| `LCD_SDA_PIN` | GPIO17 |
| `LCD_SCL_PIN` | GPIO18 |
| `LCD_I2C_CLOCK_HZ` | 50000 |
| `LCD_UPDATE_INTERVAL_MS` | 500 |
| `LCD_UPDATE_WHILE_MOVING` | `0` |
| `LCD_TEMP_MESSAGE_DURATION_MS` | 1800 |
| `LCD_SHOW_TELEMETRY` | `1` |
| `LCD_SHOW_RFID_STATUS` | `1` |

LCD functions present:

- `setupLCD()`
- `updateLCD()`
- `lcdShowStartup()`
- `lcdShowNormal()`
- `lcdShowMoving()`
- `lcdShowDoor()`
- `lcdShowRFID()`
- `lcdShowWarning()`
- `lcdShowError()`
- `lcdShowMessageTemporary(...)`
- `lcdClearLine(...)`
- `formatLCDText(...)`

Current LCD design:

- Uses `Wire.h` and `LiquidCrystal_I2C.h`.
- Defaults to address `0x27`, with support for `0x3F`.
- Has I2C scanner and alternate pin-pair scan helpers.
- Avoids LCD updates while moving by default to protect stepper timing.
- Writes only when controlled by interval/change logic to reduce flicker.
- Includes temporary message screens for requests, arrivals, RFID tests, warnings, reset, and errors.

Important observed hardware issue:

- The LCD backlight/squares can be on while I2C scan finds no device. That means the HD44780 LCD has power/contrast, but the ESP32 does not see the I2C backpack. Likely causes are wrong SDA/SCL wiring, no common GND, backpack not soldered, wrong backpack address, damaged module, 5 V pull-up/level mismatch, or incorrect board pin labels.

Electrical warning:

- Many PCF8574 LCD backpacks powered at 5 V pull SDA/SCL up to 5 V. ESP32-S3 GPIO is 3.3 V logic and is not 5 V tolerant. Use a level shifter or ensure I2C pull-ups go to 3.3 V. Do not connect 5 V I2C pull-ups directly to ESP32 GPIO.

### MQTT / Ditto Firmware Context

Current firmware MQTT constants:

- `THING_ID = building:floor1:elevator`
- `MQTT_THING_ID = building-floor1-elevator`
- `MQTT_TELEMETRY_TOPIC = elevator/building-floor1-elevator/telemetry`
- `MQTT_EVENTS_TOPIC = elevator/building-floor1-elevator/events`
- `MQTT_COMMANDS_TOPIC = elevator/building-floor1-elevator/commands`
- `MQTT_STATUS_TOPIC = elevator/building-floor1-elevator/status`

Current firmware publishes JSON in a Ditto-compatible feature structure. MQTT processing and publishing are gated/skipped while moving to protect step timing.

Current firmware command handling includes:

- floor movement through `MOVE_TO_FLOOR`
- emergency stop
- reset
- home
- fan control

Security issue: Wi-Fi SSID, Wi-Fi password, and MQTT server IP are hardcoded in the sketch. This is acceptable for a local prototype but should be replaced with a credentials/provisioning strategy before wider use.

### Serial Monitor Commands

Current Serial commands printed by setup:

| Command | Meaning |
| --- | --- |
| `0..3` | Request floor. |
| `Q` | Dump request table. |
| `S` | Soft stop to `ERROR_STOP`. |
| `E` | Emergency stop. |
| `R` | Reset to IDLE while keeping current floor. |
| `H` | Home: set current floor to `START_FLOOR`. |
| `x` | Fresh-start reset: clear requests/counters/timers. |
| `I` | Scan I2C bus for LCD address. |
| `J` | Scan safe alternate LCD I2C pin pairs. |
| `K` | Reinitialize LCD after wiring/address fix. |
| `C` | Clear LCD. |
| `D` | Print LCD configuration. |
| `L` | Run non-blocking LCD screen test. |
| `G/g` | RFID LCD/security test: granted / denied event. |
| `B` | Test buzzer normal beep. |
| `T` | Force buzzer GPIO HIGH for 2 seconds. |
| `t` | Force buzzer GPIO LOW for 2 seconds. |
| `N` | Release buzzer GPIO / stop test. |
| `W` | Test warning beep. |
| `F` | Fan manual ON. |
| `f` | Fan manual OFF. |
| `U/u` | Fan GPIO diagnostic HIGH / LOW. |
| `Z/z` | Fan GPIO diagnostic INPUT / INPUT_PULLUP. |
| `a` | Fan AUTO mode. |

## 4. Hardware Pin Map

Current detected pin map from the sketches:

| Subsystem | Signal | V6 pin | `main_esp_32_code_smart_elevator` pin | Notes |
| --- | --- | ---: | ---: | --- |
| Stepper driver | PUL / step | GPIO39 | GPIO39 | Commented as `PUL-`. Verify driver PUL+/PUL- wiring and common GND. |
| Stepper driver | DIR | GPIO40 | GPIO40 | Commented as `DIR-`. Direction polarity controlled by firmware. |
| Door H-bridge | IN1 | GPIO38 | GPIO38 | L298N/HW-095 door motor direction. |
| Door H-bridge | IN2 | GPIO37 | GPIO37 | L298N/HW-095 door motor direction. |
| Door H-bridge | EN/PWM | GPIO36 | GPIO36 | PWM speed control. |
| Fan relay | Relay input | GPIO16 | GPIO16 | Active-low; OFF uses input/high-Z. |
| Outside hall call | Floor 0 UP | GPIO9 | GPIO9 | Button to GND, internal pull-up assumed. |
| Outside hall call | Floor 1 UP | GPIO10 | GPIO11 | Pin difference between sketches. Confirm wiring. |
| Outside hall call | Floor 1 DOWN | GPIO11 | GPIO10 | Pin difference between sketches. Confirm wiring. |
| Outside hall call | Floor 2 UP | GPIO12 | GPIO13 | Pin difference between sketches. Confirm wiring. |
| Outside hall call | Floor 2 DOWN | GPIO13 | GPIO12 | Pin difference between sketches. Confirm wiring. |
| Outside hall call | Floor 3 DOWN | GPIO14 | GPIO14 | Button to GND, internal pull-up assumed. |
| Cabin button | Floor 0 | GPIO1 | GPIO1 | Verify board-specific use; low-number pins may be routed on some boards. |
| Cabin button | Floor 1 | GPIO2 | GPIO2 | Verify board-specific use. |
| Cabin button | Floor 2 | GPIO42 | GPIO42 | Verify exposed pin and boot behavior on exact board. |
| Cabin button | Floor 3 | GPIO41 | GPIO41 | Verify exposed pin and boot behavior on exact board. |
| Emergency stop | Input | GPIO35 | GPIO35 | Button to GND with internal pull-up. |
| Simulated temperature | ADC | GPIO4 | GPIO4 | ADC1 input. |
| Simulated vibration | ADC | GPIO5 | GPIO5 | ADC1 input. |
| Simulated load | ADC | GPIO6 | GPIO6 | ADC1 input. |
| Buzzer | Output / sink | GPIO47 | GPIO47 | Do not drive high-current or >3.3 V buzzer directly. |
| LCD 1604A I2C | SDA | GPIO17 | GPIO17 | Configurable; current scanner found no device in user logs. |
| LCD 1604A I2C | SCL | GPIO18 | GPIO18 | Configurable; use level shifting if backpack pull-ups are 5 V. |
| RFID RC522 | SPI SCK/MISO/MOSI/SS/RST | Not assigned | Not assigned | Planned only. No MFRC522 driver yet. |
| LED matrix | LTP-1457AC | Not assigned | Not assigned | Explicitly unused. No MAX7219/raw matrix dependency detected. |
| Hall sensors | Floor sensors | Not assigned | Not assigned | Considered, not active in current firmware. |

ESP32-S3 pin risk notes:

- Avoid GPIO26-GPIO32 on ESP32-S3 N16R8 modules because these are commonly tied to flash/PSRAM. The current code has a compile-time guard against placing the buzzer there.
- Avoid boot/strap-sensitive pins unless intentionally designed and validated. Common ESP32-S3 strapping pins include GPIO0, GPIO3, GPIO45, and GPIO46.
- Avoid GPIO19/GPIO20 if native USB is required.
- Avoid GPIO43/GPIO44 if using the default UART/Serial path on boards that expose/use those pins.
- Verify every high-number GPIO against the exact 44-pin board pinout. Dev board labels vary.
- Because the current sketches consume many pins, reserve future RFID SPI pins only after the final button/LCD wiring is frozen.

## 5. Elevator Behavior Context

Expected physical behavior:

- Four floors: 0, 1, 2, 3.
- Six hall calls:
  - F0 UP
  - F1 UP
  - F1 DOWN
  - F2 UP
  - F2 DOWN
  - F3 DOWN
- Four cabin calls: F0, F1, F2, F3.
- Door is closed by default before movement.
- Cabin moves with NEMA17 open-loop stepper motion.
- Door opens on arrival, waits for dwell timer, then closes.
- Current-floor request opens or extends the door.
- Fan runs during movement/activity/cooldown or thermal conditions.
- Buzzer should acknowledge accepted requests, arrivals, warnings, denied RFID, and faults.
- LCD should show state, floor, target, door, telemetry, warnings, and security status.
- Emergency/error states should stop stepper and door motor and require reset.

Current firmware behavior is mostly aligned with this, except:

- Multi-floor movement is one-floor segmented and can physically pause at each intermediate floor.
- There is no physical floor sensor validation.
- Door open/closed state is inferred only by timed pulses.
- RFID hardware is not integrated yet.

## 6. Smart Elevator Dispatching Logic

Current algorithm:

- Maintains cabin, up, and down request tables.
- Filters duplicates.
- Serves current-floor requests by door open/extend behavior.
- Uses a collective selective strategy.
- Continues same direction when possible.
- Picks requests ahead in the active direction before reversing.
- Handles endpoint floors as natural reversal points.
- Logs compatible pickup candidates while moving.

Target algorithm for the prototype:

- Same-direction pickup while moving.
- Opposite-direction calls queued until the current direction is complete.
- Cabin requests served in direction order.
- Duplicate request filtering.
- Current-floor request opens/extends door.
- Door-open request extension.
- Endpoint reversal.
- Fairness and no starvation.
- No unnecessary stop at floors with no request.
- Continuous multi-floor travel or floor-sensor-confirmed travel.

Known dispatch/movement issue:

- The current step-count implementation completes a one-floor segment, then decides whether to serve or pass the floor. This is logically safe for tracking virtual floor boundaries, but mechanically it can slow/stop at every floor. The next firmware movement refactor should preserve the request algorithm while changing the motor planner to run continuously across intermediate floors unless a stop is required.

## 7. Sensors and Simulated Telemetry

The three 10K potentiometers simulate:

| Sensor | Current pin | Suggested range | Current firmware use |
| --- | ---: | --- | --- |
| Temperature | GPIO4 | 20-100 degC | Motor/cabin thermal telemetry, fan, warning, safety interlock. |
| Vibration | GPIO5 | 0.000-0.600 g | Motor health, warning, safety interlock. |
| Load | GPIO6 | 0-1000 kg | Cabin load, overload warning, movement lockout. |

Recommended telemetry interpretation:

- Normal vibration should remain near a low baseline such as 0.02-0.06 g.
- Warning vibration can start near 0.12 g.
- Critical vibration can start near 0.25 g.
- Load over 800 kg should trigger overload warning and movement block.
- Temperature over 70 degC should warn; over 85 degC should be treated as critical.
- ADC values should be smoothed and warnings should be confirmed over time to avoid false triggers.

Ditto mapping:

- Cabin feature: `current_floor`, `target_floor`, `direction`, `load_kg`, `temperature_c`, `speed_ms`, `emergency_stop`.
- Motor feature: `vibration_level`, `temperature_c`, `health_status`, `current_draw_a`, `power_kw`.
- Security feature: RFID status and alert level.
- Fan feature: fan state, mode, reason, duty cycle/runtime if available.

## 8. RFID Access Control Context

Intended RFID module:

- RC522/MFRC522.
- 3.3 V only. Do not power RC522 from 5 V.
- SPI interface; pins are not assigned in current firmware.
- Only 2 physical cards are available.

Recommended role model:

- Card 1: `ADMIN` or `MAINTENANCE`.
- Card 2: `USER`.
- Unknown cards denied.

Recommended access model:

- Scanning an authorized card starts a short session.
- Session timeout should expire automatically.
- `ADMIN`/`MAINTENANCE` can access maintenance or all floors.
- `USER` can access allowed floors only.
- Cabin button requests can require an active authorized session if desired.
- Hall calls should probably remain public unless the demo requires locked access.
- RFID denial must not abruptly stop an already moving cabin unless the denial implies security lockdown.
- Unauthorized attempts should increment counters and publish security events.

Future Ditto/security mapping:

- `features.security.properties.rfid_last_card`
- `features.security.properties.rfid_access_granted`
- `features.security.properties.unauthorized_access_attempts`
- `features.security.properties.alert_level`
- `features.security.properties.state`
- `features.incident_log.properties.entries`

## 9. LCD 1604A I2C Context

The active display target is the LCD 1604A I2C screen:

- 16 columns x 4 rows.
- Likely PCF8574 backpack.
- Common addresses: `0x27` and `0x3F`.
- Pins: GND, VCC, SDA, SCL.

Current firmware layout intent:

- Normal/moving:
  - floor
  - target
  - direction
  - state
  - door state
  - telemetry
  - RFID short status
- Warning:
  - warning type
  - affected subsystem
  - measured value
  - action hint
- Error:
  - persistent error screen
  - reason
  - reset instruction
- Temporary messages:
  - request accepted
  - queued floor
  - arrived
  - reset done
  - RFID granted/denied

Current practical issue:

- I2C scans from the firmware showed no detected device on configured pins or alternate candidate pairs. The LCD showing squares only means it has power and contrast, but the I2C backpack is not communicating.

LCD hardware checklist:

- Confirm SDA from backpack goes to configured GPIO17.
- Confirm SCL from backpack goes to configured GPIO18.
- Confirm common GND between LCD backpack and ESP32.
- Confirm VCC matches the backpack behavior.
- If powered by 5 V, verify SDA/SCL pull-ups are not to 5 V or use a level shifter.
- Adjust contrast potentiometer on the backpack.
- Check solder joints between PCF8574 backpack and LCD header.
- Run Serial command `I` for configured-bus scan.
- Run Serial command `J` for alternate pin-pair scan.
- Run Serial command `D` to print LCD configuration.
- Run Serial command `K` after rewiring.

## 10. Buzzer Context

Planned buzzer events:

| Event | Pattern intent |
| --- | --- |
| Button accepted | Short beep. |
| Request queued | Distinct short queued beep. |
| Arrival | Double beep. |
| Door open/close | Optional short door beep. |
| RFID granted | Positive short beep. |
| RFID denied | Warning beep. |
| Warning | Repeating warning pattern. |
| Error/emergency | Repeating error pattern until reset/clear. |

Implementation requirement:

- Buzzer must remain non-blocking and `millis()`-scheduled.
- No long `delay()` calls should be added for sound patterns.
- If the buzzer uses 5 V or 12 V, drive it through a transistor/MOSFET driver, not directly from GPIO47.

## 11. Safety and Reliability Context

Safety rules for firmware evolution:

- Never move with the door open, opening, or waiting open.
- Stop stepper pulses and door motor immediately in `ERROR_STOP` and `EMERGENCY`.
- Preserve reset behavior: reset clears requests/fault flags but should not invent a physical floor.
- Validate target floors are within 0-3.
- Reject invalid hall direction requests at endpoints.
- Block movement on overload.
- Confirm noisy ADC safety faults before latching hard faults.
- Do not allow RFID denial to cause unsafe sudden stop unless security policy explicitly escalates to emergency/lockdown.
- Add movement timeout protection for every travel command.
- Add physical floor feedback or a homing/calibration process before relying on open-loop positioning for long demos.
- Door motor should eventually have endstop/limit/obstruction feedback.
- Fan should remain available during thermal faults.
- Cloud commands must never bypass device-side interlocks.

## 12. Digital Twin / IoT Context

### MQTT

Canonical topic convention:

```text
elevator/{mqtt_safe_thing_id}/telemetry
elevator/{mqtt_safe_thing_id}/events
elevator/{mqtt_safe_thing_id}/commands
elevator/{mqtt_safe_thing_id}/status
```

For `building:floor1:elevator`, the MQTT-safe ID is `building-floor1-elevator`.

MQTT is the ingestion and command transport layer. It should not be the dashboard's authoritative state source. The dashboard should read the current elevator state from Eclipse Ditto.

### Eclipse Ditto

Ditto Thing ID:

```text
building:floor1:elevator
```

REST path:

```text
/api/2/things/{thingId}
```

Provisioning scripts create/update a Thing with these features:

- `cabin`
- `door`
- `motor`
- `security`
- `microcontroller`
- `incident_log`
- `energy`
- `performance`
- `predicted_failures`
- `ai_analysis`
- `maintenance_schedule`

### Bridge

`dashboard/backend/bridge.js`:

- Subscribes to `elevator/+/telemetry`, `elevator/+/events`, and `elevator/+/status`.
- Parses JSON.
- Normalizes aliases such as `payload_weight_kg` to `load_kg`, and `vibration_g` to `vibration_level`.
- Writes specific feature/property paths to Ditto.
- Tracks microcontroller online/offline state from status and telemetry heartbeat.
- Retries Ditto writes and skips duplicate path writes.

### Dashboard

The Next.js dashboard:

- Uses Ditto as the main state source through `useDitto`.
- Has SSE with REST polling fallback.
- Has MQTT client support mostly for connection status and optional telemetry support.
- Contains SCADA-style panels for telemetry, security, command safety gate, digital twin, alerts, history, maintenance, energy, and system health.
- Routes commands through `/api/commands`.

### Command Safety Gate

Dashboard command flow:

```text
Operator UI -> /api/commands -> validateCommand() -> control_command_log/audit_log
             -> Ditto writes -> MQTT command publish -> ESP32 firmware
```

Commands are rejected by default unless in the catalog. The gate checks target floor bounds, source, role/source class, reason/confirmation requirements, emergency state, door state, overload, forced entry, risk score, system mode, stale twin state, and cooldown.

### n8n Agents

Workflow set:

| Workflow | Trigger | Responsibility |
| --- | --- | --- |
| `01_ingestion_surveillance_agent` | Schedule: poll Ditto every 5 seconds | Canonicalize twin state, archive telemetry to Postgres, dedupe, route significant events. |
| `02_analysis_ai_brain_agent` | Webhook | Deterministic risk scoring, optional Ollama explanation, action routing. |
| `03_control_agent` | Webhook | Validate and transform control actions into Ditto writes. |
| `04_security_maintenance_agents` | Schedule and webhooks | Security state machine, RFID/security escalation, predictive maintenance. |
| `05_notification_agent` | Webhook and schedule | Notification outbox, delivery retries, Telegram/email/SMS/voice channels if configured. |
| `06_optimization_audit_agents` | Schedules and audit webhook | Predictive dispatch, energy optimization, compliance report, audit log insertion. |

### Database

Postgres/Timescale stores:

- `telemetry_raw`
- `audit_log`
- `notification_outbox`
- `agent_state`
- `control_command_log`
- `maintenance_work_orders`
- `system_health_history`
- aggregate views such as `hourly_risk` and `hourly_energy`

## 13. Current Problems and Risks

Highest-priority embedded risks:

- The motor planner currently slows/stops at every floor boundary because travel is segmented by one floor.
- No real floor sensors are integrated; floor position is open-loop step count only.
- Stepper pulse generation is timing-sensitive and can be disturbed by Serial, MQTT, Wi-Fi, I2C LCD writes, or blocking code.
- LCD I2C hardware is currently not detected by scanner despite screen power.
- Door state is timed, not physically verified.
- Door motor has no limit switch or obstruction feedback.
- RFID hardware is not yet integrated.
- Wi-Fi and MQTT settings are hardcoded in firmware.
- ADC potentiometers simulate safety values and are not calibrated physical sensors.
- Buzzer GPIO drive may be unsafe if the buzzer is powered above 3.3 V or draws more current than a GPIO can sink.

Electrical risks:

- ESP32-S3 GPIO is not 5 V tolerant.
- LCD backpacks powered from 5 V may pull SDA/SCL to 5 V.
- RC522 must be powered at 3.3 V, not 5 V.
- Relay modules can require 5 V input or more current than an ESP32 GPIO can provide.
- L298N/HW-095 motor supply noise can disturb ESP32 unless grounds, decoupling, and wiring are solid.
- ATX power is suitable for current capacity but common ground and rail stability must be verified under motor load.

Pin risks:

- Current pin usage is dense.
- RFID SPI pins are not reserved.
- Two ESP32 sketches disagree on F1/F2 hall-call pin order.
- Avoid GPIO26-GPIO32 on N16R8 modules because flash/PSRAM can use them.
- Avoid boot/strap and USB/Serial pins unless the exact board pinout confirms they are safe.

Platform risks:

- MQTT broker currently allows anonymous access in local setup.
- Ditto credentials/defaults are development-grade.
- Dashboard auth is not production-grade identity management.
- n8n credential IDs in exported workflows must be reattached manually after import.
- Ditto runs in a separate external stack, not in this repository's Compose file.
- The simulator is strong for software validation but cannot validate mechanical safety.

## 14. Recommended Next Steps

Priority roadmap:

1. Freeze the active Arduino sketch.
   - Decide whether `main_esp_32_code_smart_elevator_v6` or `main_esp_32_code_smart_elevator` is the canonical firmware folder.
   - Remove or clearly mark the other as legacy after validation.

2. Freeze and verify the pin map.
   - Resolve the F1/F2 hall button pin mismatch between the two sketches.
   - Choose and reserve RFID SPI pins.
   - Confirm every GPIO on the exact ESP32-S3 N16R8 44-pin board pinout.
   - Document wiring with photos and a table.

3. Stabilize motion before adding more features.
   - Fix the multi-floor stepper planner so it does not stop at unrequested intermediate floors.
   - Preserve collective request logic.
   - Add homing/calibration procedure.
   - Consider Hall sensors for floor validation or at least reference homing.

4. Test each hardware module independently.
   - Stepper one-floor calibration.
   - Door open/close pulse tuning.
   - Fan relay active-low/high-Z behavior.
   - ADC potentiometer ranges.
   - Buzzer electrical driver.
   - LCD I2C detection.
   - RFID read test.

5. Fix LCD hardware detection before further LCD software changes.
   - Use Serial `I`, `J`, `D`, and `K`.
   - Verify SDA/SCL, common GND, contrast, backpack soldering, address, and I2C voltage level.

6. Integrate RFID properly.
   - Add `SPI.h` and `MFRC522.h`.
   - Assign safe pins.
   - Register two card UIDs.
   - Add roles, session timeout, denied-attempt counter, LCD/buzzer messages, and Ditto security telemetry.

7. Harden safety behavior.
   - Door feedback.
   - Movement timeout.
   - E-stop latch.
   - Reset semantics.
   - Local interlocks for every cloud command.

8. Clean up IoT configuration.
   - Move Wi-Fi/MQTT credentials out of source.
   - Publish retained/last-will status.
   - Add command acknowledgements on `elevator/{id}/commands/ack` or status.
   - Keep JSON payloads lightweight.

9. Align firmware telemetry with Ditto schema.
   - Verify all required feature fields update correctly in Ditto.
   - Validate MQTT topics with `scripts/validate_mqtt_topics.py`.
   - Confirm dashboard reads from Ditto, not direct MQTT state.

10. Run end-to-end validation.
    - ESP32 serial evidence.
    - MQTT capture.
    - Ditto before/after snapshots.
    - n8n execution logs.
    - Postgres rows.
    - Dashboard screenshots.
    - Physical video for thesis evidence.

## 15. Testing Checklist for LCD and Firmware

Embedded test scenarios to preserve:

| Scenario | Expected result |
| --- | --- |
| Power on | LCD startup screen if I2C detected; Serial reports LCD config and system ready. |
| Idle at floor 0 | LCD shows floor 0, state IDLE, door closed/default, ready. |
| Request floor 3 | Serial logs request; buzzer short beep; LCD temporary request message; target becomes 3. |
| Moving up | LCD updates are currently skipped/frozen while moving to protect step timing; Serial status is also gated. |
| Arrival | LCD shows arrived/door state after movement; buzzer arrival pattern. |
| Door sequence | Open pulse, dwell countdown/status, close pulse. |
| RFID authorized simulation `G` | LCD/security status shows granted role; buzzer positive pattern. |
| RFID denied simulation `g` | LCD/security status shows denied; warning beep. |
| Potentiometer changes | Temperature/vibration/load update in Serial, LCD when allowed, MQTT telemetry. |
| Overload/temp/vibration warning | Warning LCD/buzzer and movement lockout as configured. |
| Error/emergency | Persistent fault screen; motors stopped; reset required. |
| Wrong LCD address/disconnected | Serial reports no I2C devices; firmware continues without crashing. |

## 16. Explicit Unknowns and Assumptions

Unknowns:

- Exact ESP32-S3 N16R8 44-pin board schematic/pin exposure.
- Final active firmware folder.
- Real wiring of all 10 push buttons.
- Real MicrostepDriver input wiring and whether PUL/DIR polarity is optimal.
- Real door motor travel time and whether 505 ms is mechanically safe.
- LCD backpack address and pull-up voltage.
- Whether LCD backpack solder joints are good.
- RFID SPI pin selection and card UIDs.
- Buzzer current draw and whether it is active/passive.
- Relay module input circuit and 3.3 V compatibility.
- Whether HW-484 Hall sensors will be reintroduced.

Assumptions used in this document:

- The physical prototype remains 4 floors, numbered 0-3.
- The LCD 1604A I2C display is the active local HMI.
- The LED matrix exists physically but is out of scope and must remain unused.
- MQTT topic convention is `elevator/{mqtt_safe_thing_id}/{telemetry|events|commands|status}`.
- Eclipse Ditto is the source of truth for dashboard state.
- Cloud/AI commands must pass deterministic safety gates and still be checked by firmware interlocks.
