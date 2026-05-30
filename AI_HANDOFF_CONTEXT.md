# AI Handoff Context: Smart Elevator Digital Twin

Use this compact context when starting a new AI/Codex session.

## Project Identity

Project: Smart and Secure Elevator Digital Twin Platform for a master thesis on an Agentic AI-driven Digital Twin for smart elevator management.

Core architecture:

```text
ESP32-S3 -> MQTT -> bridge/n8n -> Eclipse Ditto -> Next.js SCADA dashboard
Dashboard commands -> /api/commands safety gate -> Ditto control intent -> bridge -> MQTT commands -> ESP32-S3
```

Rules:

- Eclipse Ditto is the source of truth.
- MQTT is ingestion/command transport, not the UI source of truth.
- UI != logic != data != control.
- Do not integrate the LTP-1457AC LED matrix.
- Active local display target is LCD 1604A I2C, 16x4.

## Current Hardware

- ESP32-S3 N16R8 / 44-pin board.
- NEMA17 stepper through MicrostepDriver using PUL and DIR only.
- Door motor from disk opener/closer mechanism through L298N/HW-095.
- 6 hall buttons and 4 cabin buttons.
- Fan through JQC3F-05VDC-C relay module.
- 3x 10K potentiometers for simulated temperature, vibration, load.
- Buzzer rated 3-24 V DC.
- RC522/MFRC522 RFID planned, only 2 cards available.
- LCD 1604A I2C, likely PCF8574 at 0x27 or 0x3F.
- ATX supply for 12 V/5 V rails with common GND.

## Firmware Files

Two ESP32 sketches exist and should be reconciled:

- `main_esp_32_code_smart_elevator_v6/main_esp_32_code_smart_elevator_v6.ino`
- `main_esp_32_code_smart_elevator/main_esp_32_code_smart_elevator.ino`

The V6 folder appears newest by banner/version naming. The other folder is also active because changes were previously mirrored there. Do not assume one is safe to ignore until the user confirms the Arduino IDE target.

Current firmware includes:

- Step-count movement.
- Door pulse timing.
- Collective request tables.
- Fan auto/manual logic.
- ADC simulated telemetry.
- Buzzer scheduler.
- LCD HMI code.
- MQTT telemetry and command handling.
- RFID display/test hooks only, not real RC522 integration.

## Current Pin Map

| Subsystem | Signal | Pin |
| --- | --- | ---: |
| Stepper | PUL/STEP | GPIO39 |
| Stepper | DIR | GPIO40 |
| Door H-bridge | IN1 | GPIO38 |
| Door H-bridge | IN2 | GPIO37 |
| Door H-bridge | EN/PWM | GPIO36 |
| Fan relay | IN | GPIO16 |
| Hall call | F0 UP | GPIO9 |
| Hall call | F1 UP | V6 GPIO10, main sketch GPIO11 |
| Hall call | F1 DOWN | V6 GPIO11, main sketch GPIO10 |
| Hall call | F2 UP | V6 GPIO12, main sketch GPIO13 |
| Hall call | F2 DOWN | V6 GPIO13, main sketch GPIO12 |
| Hall call | F3 DOWN | GPIO14 |
| Cabin | F0 | GPIO1 |
| Cabin | F1 | GPIO2 |
| Cabin | F2 | GPIO42 |
| Cabin | F3 | GPIO41 |
| Emergency stop | Input | GPIO35 |
| Pot temp | ADC | GPIO4 |
| Pot vibration | ADC | GPIO5 |
| Pot load | ADC | GPIO6 |
| Buzzer | Output/sink | GPIO47 |
| LCD | SDA/SCL | GPIO17/GPIO18 |
| RFID | SPI pins | Not assigned |

Pin risks:

- Avoid GPIO26-GPIO32 on ESP32-S3 N16R8 because flash/PSRAM may use them.
- Avoid boot/strap pins such as GPIO0, GPIO3, GPIO45, GPIO46 unless verified.
- Avoid GPIO19/20 if native USB is needed.
- Avoid GPIO43/44 if Serial/UART use depends on them.
- Confirm exact 44-pin board pinout before changing hardware.

## Current Firmware Behavior

State machine:

- `ST_IDLE`
- `ST_DOOR_OPENING`
- `ST_DOOR_OPEN_WAIT`
- `ST_DOOR_CLOSING`
- `ST_MOVING_UP`
- `ST_MOVING_DOWN`
- `ST_ARRIVED`
- `ST_ERROR_STOP`
- `ST_EMERGENCY`

Movement is open-loop step-count-based, not sensor-based. There are no Hall sensors in active firmware. Constants include `STEPS_PER_FLOOR = 4500`, fast step delay 900 us, slow step delay 1500 us, and max one-floor travel 10000 ms.

Important known bug/limitation:

- The motor planner moves one floor segment at a time. It can slow/stop at every intermediate floor even when no request exists there. Future work should preserve dispatch logic but implement continuous multi-floor travel or physical floor-sensor feedback.

Door logic:

- L298N/HW-095 timed pulses.
- Open/close pulse about 505 ms.
- Dwell about 5000 ms.
- No door limit switch or obstruction feedback yet.

Dispatch:

- Uses `cabinRequests`, `hallUpRequests`, `hallDownRequests`.
- Filters duplicates and invalid endpoint directions.
- Same-floor request opens/extends/reopens door.
- Same-direction pickups are recognized, opposite calls stay queued.
- Fairness is partially present but not formally proven.

Fan:

- GPIO16 active-low relay.
- ON = output LOW.
- OFF = input/high-Z.
- Auto fan runs during movement/cooldown and thermal conditions.

Buzzer:

- GPIO47 scheduler, non-blocking.
- Current direct-GPIO low-side assumption is only safe for low-current 3.3 V buzzers. Use a transistor/MOSFET for 5 V/12 V buzzers.

LCD:

- Uses `Wire.h` and `LiquidCrystal_I2C.h`.
- Configured address 0x27, fallback/test support for 0x3F.
- GPIO17 SDA, GPIO18 SCL.
- Update interval 500 ms.
- Updates while moving disabled to protect step timing.
- User observed squares only and I2C scan found no device on several pin pairs, so current issue is likely wiring/address/backpack/pull-up/level-shift, not just display text.

RFID:

- Real RC522 is not integrated yet.
- Only display/security helper and Serial tests `G/g` exist.
- Need `SPI.h`, `MFRC522.h`, safe pin selection, UID list for two cards, roles, session timeout, denial logging.

## Serial Commands

Useful commands:

- `0..3`: request floor.
- `Q`: dump request table.
- `S`: soft stop / error.
- `E`: emergency.
- `R`: reset to idle, current floor kept.
- `H`: home to start floor.
- `x`: fresh-start reset.
- `I`: LCD I2C scan.
- `J`: alternate LCD pin-pair scan.
- `K`: reinitialize LCD.
- `C`: clear LCD.
- `D`: LCD config.
- `L`: LCD screen test.
- `G/g`: simulated RFID grant/deny.
- `B`, `T`, `t`, `N`, `W`: buzzer tests.
- `F`, `f`, `U/u`, `Z/z`, `a`: fan tests/mode.

## Digital Twin Software

Important files:

- `esp32_simulator.py`: Python simulator with physics, anomalies, MQTT, Ditto envelope, health file.
- `ELEVATOR_SIMULATOR_ESP8266/ELEVATOR_SIMULATOR_ESP8266.ino`: legacy ESP8266 simulator.
- `docker-compose.yml`: Mosquitto, bridge, optional simulator, n8n, Postgres/Timescale, optional Ollama.
- `dashboard/backend/bridge.js`: MQTT-to-Ditto bridge, normalizes aliases and updates Ditto.
- `dashboard/app/api/commands/route.js`: command safety endpoint; persists decisions and writes accepted intent to Ditto, including `features/control/properties/pending_command`. It must not publish MQTT directly.
- `dashboard/src/lib/commandSafetyGate.js`: deterministic command validator.
- `dashboard/backend/bridge.js`: MQTT-to-Ditto bridge and Ditto command-intent reconciler; bridge owns MQTT command fanout using the `bridge` broker identity.
- `dashboard/components/ElevatorOS.jsx`: main SCADA UI.
- `scripts/init-ditto.ps1` and `.sh`: provision Ditto policy/Thing.
- `N8n workflows/*.json`: six agent workflows.
- `postgres/init/*.sql`, `postgres/migrations/*.sql`: telemetry/audit/command/maintenance schemas.
- `docs/validation/test-matrix.md`: validation matrix.

Ditto Thing:

- Thing ID: `building:floor1:elevator`.
- MQTT-safe ID: `building-floor1-elevator`.
- Topics: `elevator/building-floor1-elevator/{telemetry,events,commands,status}`.
- Features: `cabin`, `door`, `motor`, `security`, `microcontroller`, `incident_log`, `control`, `energy`, `performance`, `predicted_failures`, `ai_analysis`, `maintenance_schedule`.

n8n workflows:

- `01_ingestion_surveillance_agent`: polls Ditto every 5 s, archives telemetry, routes events.
- `02_analysis_ai_brain_agent`: deterministic risk engine plus optional Ollama explanation.
- `03_control_agent`: command validation and Ditto write planning.
- `04_security_maintenance_agents`: security state and predictive maintenance.
- `05_notification_agent`: outbox and delivery retries.
- `06_optimization_audit_agents`: predictive dispatch, energy optimization, audit.

## Main Risks

- Open-loop floor positioning can drift.
- Current one-floor segment planner causes unwanted intermediate stops.
- LCD I2C not detected in hardware logs.
- LCD backpack may pull I2C to 5 V; ESP32-S3 is not 5 V tolerant.
- RC522 must be 3.3 V only.
- Relay and buzzer may need transistor/level-driver circuits.
- Door has no endstop/obstruction feedback.
- Wi-Fi/MQTT credentials are hardcoded in firmware.
- RFID pins and logic are not implemented.
- Two sketches disagree on hall-call pin order.
- Ditto stack is external to this repo's Compose file.
- MQTT broker/auth are local-development grade.

## Recommended Next Work

1. Decide the canonical ESP32 sketch.
2. Freeze pin map and document wiring.
3. Fix motor planner before adding more UI/RFID features.
4. Bring up LCD electrically using `I`, `J`, `D`, `K`.
5. Integrate real RC522 RFID with two cards and roles.
6. Add command acknowledgements from ESP32.
7. Move Wi-Fi/MQTT config out of source.
8. Validate telemetry through MQTT -> bridge -> Ditto -> dashboard.
9. Use validation evidence: Serial logs, MQTT capture, Ditto snapshots, n8n runs, DB rows, dashboard screenshots, physical videos.
