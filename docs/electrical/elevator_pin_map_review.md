# ESP32-S3 Pin Map Review — Smart Elevator Prototype (Rev B)

**Project:** Agentic AI-Driven Digital Twin for Smart and Secure Elevator Management
**Board:** ESP32-S3-DevKitC-1 (U1) · **Date:** 2026-06-11 · **Schematic rev:** B (A3, single sheet)
**Reviewed against:** `main_esp_32_code_smart_elevator_v6.ino` (firmware v6) and thesis `master-thesis1`.

---

## 1. Full GPIO table

| Component | Signal | GPIO | Voltage | Direction | Active level | Status | Evidence source | Risk note |
|---|---|---|---|---|---|---|---|---|
| KY-024 F0 | floor 0 confirm | GPIO8 | 3.3 V | input | TBD (bench) | DESIGN-ASSIGNED, not in fw v6 | user design spec; thesis ch.2 | none — free, non-strap pin |
| KY-024 F1 | floor 1 confirm | GPIO3 | 3.3 V | input | TBD (bench) | DESIGN-ASSIGNED, not in fw v6 | user design spec | **C2 — strap/JTAG-sensitive** |
| KY-024 F2 | floor 2 confirm | GPIO46 | 3.3 V | input | TBD (bench) | DESIGN-ASSIGNED, not in fw v6 | user design spec | **C3 — strap pin, board check** |
| KY-024 F3 | floor 3 confirm | GPIO0 | 3.3 V | input | TBD (bench) | DESIGN-ASSIGNED, not in fw v6 | user design spec | **C1 — BOOT strap, must be HIGH at reset** |
| SPDT S1 | door open limit | GPIO7 | 3.3 V | input | HIGH at limit (NC) | DESIGN-ASSIGNED, not in fw v6 | user design spec; thesis ch.2 | none — free pin |
| SPDT S2 | door closed limit | GPIO15 | 3.3 V | input | HIGH at limit (NC) | DESIGN-ASSIGNED, not in fw v6 | user design spec; thesis ch.2 | none — free pin |
| Microstep driver | STEP/PUL | GPIO39 | 3.3 V | output | pulse | CONFIRMED | firmware `STEP_PIN` L43 | none |
| Microstep driver | DIR | GPIO40 | 3.3 V | output | level | CONFIRMED | firmware `DIR_PIN` L44 | none |
| L298N/HW-095 | door IN1 | GPIO38 | 3.3 V | output | pair logic | CONFIRMED | firmware `DOOR_IN1_PIN` L47 | none |
| L298N/HW-095 | door IN2 | GPIO37 | 3.3 V | output | pair logic | CONFIRMED | firmware `DOOR_IN2_PIN` L48 | **C6 — octal-PSRAM variant** |
| L298N/HW-095 | door EN/PWM | GPIO36 | 3.3 V | output | PWM | CONFIRMED | firmware `DOOR_EN_PIN` L49 | **C6 — octal-PSRAM variant** |
| Fan relay K1 | relay IN | GPIO16 | 3.3 V | output | **active-LOW** | CONFIRMED | firmware `FAN_RELAY_PIN` L52, `FAN_RELAY_ACTIVE_LOW=true` L307 | relay input type TBD |
| LCD 1604A I2C | SDA | GPIO17 | 3.3 V | bidir | open-drain | CONFIRMED | firmware `LCD_SDA_PIN` L24, 0x27 | level shifter if 5 V backpack (G1) |
| LCD 1604A I2C | SCL | GPIO18 | 3.3 V | output | open-drain | CONFIRMED | firmware `LCD_SCL_PIN` L25 | same as SDA |
| Buzzer BZ1 | buzzer drive | GPIO19 | 3.3 V | output | **active-LOW** (sinks; OFF=INPUT_PULLUP) | CONFIRMED | firmware `BUZZER_PIN` L97, L358 | **C5 — native USB D−** |
| Emergency stop S3 | e-stop | GPIO35 | 3.3 V | input | active-LOW | CONFIRMED | firmware `EMERGENCY_STOP_PIN` L71, L4465 | **C6 — octal-PSRAM variant** |
| Pot RV1 | sim. temperature | GPIO4 (ADC1_CH3) | 0–3.3 V | analogue in | n/a | CONFIRMED | firmware `SIM_TEMP_ADC_PIN` L76 | proxy only |
| Pot RV2 | sim. vibration | GPIO5 (ADC1_CH4) | 0–3.3 V | analogue in | n/a | CONFIRMED | firmware `SIM_VIB_ADC_PIN` L77 | proxy only |
| Pot RV3 | sim. load | GPIO6 (ADC1_CH5) | 0–3.3 V | analogue in | n/a | CONFIRMED | firmware `SIM_LOAD_ADC_PIN` L78 | proxy only |
| MFRC522 U4 | SS/SDA | GPIO45 | 3.3 V | output | active-LOW CS | CONFIRMED | firmware `RFID_SS_PIN` L83 | **C4 — VDD_SPI strap** |
| MFRC522 U4 | RST | GPIO20 | 3.3 V | output | active-LOW | CONFIRMED | firmware `RFID_RST_PIN` L84 | **C5 — native USB D+** |
| MFRC522 U4 | SCK | GPIO48 | 3.3 V | output | clock | CONFIRMED | firmware `RFID_SCK_PIN` L85 | on-board RGB LED on some boards (cosmetic) |
| MFRC522 U4 | MISO | GPIO21 | 3.3 V | input | n/a | CONFIRMED | firmware `RFID_MISO_PIN` L86 | none |
| MFRC522 U4 | MOSI | GPIO47 | 3.3 V | output | n/a | CONFIRMED | firmware `RFID_MOSI_PIN` L87 | none |
| Cabin button F0 | call | GPIO1 | 3.3 V | input | active-LOW | CONFIRMED | firmware `CABIN_F0_PIN` L63, L4458 | none |
| Cabin button F1 | call | GPIO2 | 3.3 V | input | active-LOW | CONFIRMED | firmware L64 | none |
| Cabin button F2 | call | GPIO42 | 3.3 V | input | active-LOW | CONFIRMED | firmware L65 | none |
| Cabin button F3 | call | GPIO41 | 3.3 V | input | active-LOW | CONFIRMED | firmware L66 | none |
| Hall button F0▲ | call | GPIO9 | 3.3 V | input | active-LOW | CONFIRMED | firmware `OUT_F0_UP_PIN` L55 | none |
| Hall button F1▲ | call | GPIO11 | 3.3 V | input | active-LOW | CONFIRMED | firmware L56 | none |
| Hall button F1▼ | call | GPIO10 | 3.3 V | input | active-LOW | CONFIRMED | firmware L57 | none |
| Hall button F2▲ | call | GPIO13 | 3.3 V | input | active-LOW | CONFIRMED | firmware L58 | none |
| Hall button F2▼ | call | GPIO12 | 3.3 V | input | active-LOW | CONFIRMED | firmware L59 | none |
| Hall button F3▼ | call | GPIO14 | 3.3 V | input | active-LOW | CONFIRMED | firmware L60 | none |

**Power pins:** 5V/VIN ← ATX +5VSB (purple) · GND ← ATX black (COMMON_GND) · 3V3 = on-board LDO **output** (feeds RC522, RV1–RV3).

## 2. Special-pin risk table

| Caution | GPIO | Used by | Class | Risk | Action before final wiring |
|---|---|---|---|---|---|
| **C1** | GPIO0 | KY-024 F3 | BOOT strap | LOW at reset → ROM download mode; board won't run app | Verify KY-024 DO level at reset; test with cabin magnet parked at F3 |
| **C2** | GPIO3 | KY-024 F1 | strap / JTAG | Reset-state level and JTAG depend on board config | Verify reset-state level; avoid unwanted pull during boot |
| **C3** | GPIO46 | KY-024 F2 | strap / input-sensitive | Special boot-mode strap (default pull-down) | Board-specific verification on this DevKitC-1 revision |
| **C4** | GPIO45 | RC522 SS | strap (VDD_SPI) | Sets internal flash/PSRAM voltage at boot | Check boot-state pull with RFID module connected |
| **C5** | GPIO19 / GPIO20 | buzzer / RC522 RST | native USB D−/D+ | May interfere with native USB/JTAG/CDC | Verify upload & debug method; confirmed free on this design |
| **C6** | GPIO35 / 36 / 37 | e-stop / door EN / door IN2 | board variant | Unavailable on octal-PSRAM (R8V) modules | Confirm DevKitC-1 variant is NOT octal-PSRAM |

All six are kept as assigned and flagged on the schematic with C1–C6 markers next to the affected pins/wires. None is a confirmed fault — each is a design check to close during the bench campaign.

## 3. GPIO0 boot risk (C1)
GPIO0 is a boot-strap pin. If the KY-024 holds it LOW at reset, the ESP32-S3 enters serial-download mode and the application does not run. Because the cabin can park at floor 3 with the magnet over U8, **the most important boot test is to power-cycle with the magnet parked at F3** and confirm a normal boot. Mitigations if it fails: pick a module/polarity with DO HIGH on detect, add RC/diode isolation during reset, or relocate F3 to a non-strap pin.

## 4. GPIO3 strapping / JTAG risk (C2)
GPIO3 is a strapping pin whose reset behaviour (and JTAG signal source selection) depends on eFuse/board configuration. As a sensor **input after boot** it is generally usable, but verify it is not pulled to an unintended level during reset and that on-board JTAG debugging is not required while it is driven.

## 5. GPIO46 board-specific risk (C3)
GPIO46 is a strapping pin (boot-mode / ROM-message group, default pull-down) exposed on the DevKitC-1 header. Usable as a digital input after boot, but **confirm behaviour on this specific board revision**; never let external circuitry force it HIGH at reset while GPIO0 is LOW.

## 6. GPIO45 strapping risk (C4)
GPIO45 is the VDD_SPI voltage strap (sets internal flash/PSRAM rail at boot). It is the RC522 chip-select. Check the boot-state pull level with the RFID module connected so the strap is not overridden at reset.

## 7. GPIO19 / GPIO20 native-USB risk (C5)
GPIO19 (buzzer) and GPIO20 (RC522 RST) are the native USB D−/D+ lines on the ESP32-S3. Using them can interfere with native USB-CDC/JTAG. The firmware comment block at L90–105 already warns about this; it is the tested thesis wiring. **Decide the upload/debug path** (UART bridge vs native USB) before committing — if native USB is needed for flashing/monitoring, these two functions conflict during that window.

## 8. ATX +5VSB standby-power behaviour
+5VSB is always live while the PSU is plugged in, independent of PS-ON. It powers ESP32 5V/VIN, so **the controller can be running while all main rails are off**. Consequence: KY-024 (+3.3 V) and the actuators are unpowered while the ESP32 reads their lines — inputs float and KY-024 outputs may back-power through their ESD diodes. Firmware should treat sensors as *unavailable* whenever main rails are off (e.g. detect via a rail-sense input or a heartbeat), and inputs should have safe pull states. Series resistors on sensor lines are a reasonable protection but are a **design check, not a fitted component**.

## 9. ATX main-rail behaviour after the KCD1 switch
PS-ON (green) is active-LOW. SW1 (KCD1) shorts PS-ON to GND (black); when closed, the ATX enables +12 V, +5 V and +3.3 V. When SW1 is open, only +5VSB remains. There is no separate ESP32 power switch in this design, so add one if the ESP32 must be fully de-powered.

## 10. KY-024 polarity bench-test requirement
The KY-024 DO is an LM393 comparator output; polarity (HIGH or LOW on magnet approach) depends on batch and trimmer. Before firmware integration: power from ATX +3.3 V; probe DO with/without the cabin magnet at the real gap; set the trimmer for clean switching with hysteresis; record trip distance both directions; repeat per floor (F0–F3); for F3 add the GPIO0 boot test (§3); record final polarity in a firmware define and the evidence package.

## 11. SPDT NC recommendation and truth table
**Recommended: NC contact, COM → GND, NC → GPIO, ESP32 internal pull-up (pending bench confirmation).**

| Condition | NC contact | GPIO level | Meaning |
|---|---|---|---|
| Away from limit | closed to GND | LOW | not reached |
| Limit reached | open | HIGH | end position confirmed |
| Wire broken | open / floating | HIGH / fault-like | requires fault handling |

Firmware implication: **active-HIGH** limit; debounce ≥ 20 ms; "both limits active simultaneously" is invalid → raise a fault; door obstruction sensing is not included. A broken wire reads HIGH (= end-stop) so the motor stops — fail-aware. Switch contacts carry only 3.3 V pull-up current, so no 5 V is injected into ESP32 GPIOs.

## 12. Power and ground notes
- One COMMON_GND node (ATX black) shared by ESP32, sensors, drivers, relay, panels — drawn as ground symbols plus the COMMON_GND label.
- Logic power (ESP32 from +5VSB, sensors from ATX +3.3 V, RC522/pots from ESP32 3V3 LDO) is separated from actuator power (+12 V to stepper/L298N/fan).
- **ESP32 3V3 (LDO output) and ATX +3.3 V (orange) are different sources — never tie them together** (G2). KY-024 uses ATX +3.3 V; RC522 and pots use ESP32 3V3.
- Motors are never powered from the ESP32.
- Used GPIOs: 34. Free: GPIO43/44 (UART0 — keep for console). Forbidden: GPIO26–32 (flash/PSRAM, firmware enforces `#error`). **No pin conflicts.**

## 13. Manual bench checks required before final thesis validation
- [ ] ATX rails measure +12 V / +5 V / +5VSB / +3.3 V; KCD1 toggles main rails; ESP32 boots from +5VSB.
- [ ] COMMON_GND continuity: ESP32 ↔ ATX ↔ both drivers ↔ relay ↔ sensors ↔ panels.
- [ ] Standby behaviour: with main rails off, confirm firmware treats sensors as unavailable; no harmful back-powering.
- [ ] KY-024 F0–F3 polarity (§10); debounce verified.
- [ ] C1 GPIO0 boot test (magnet at F3); C2 GPIO3, C3 GPIO46, C4 GPIO45 reset-state levels on this board.
- [ ] C5: decide and verify upload/debug path with GPIO19/GPIO20 in use.
- [ ] C6: confirm board is NOT octal-PSRAM (GPIO35/36/37 in use).
- [ ] SPDT NC wiring: idle LOW / pressed HIGH on GPIO7 & GPIO15; wire-break reads as end-stop; both-active = fault.
- [ ] Door motor stops on limit confirmation; dwell timer starts only after open-limit.
- [ ] LCD backpack voltage identified; level shifter fitted if 5 V; I2C scan finds 0x27.
- [ ] Relay module input type verified (no 5 V back-feed into GPIO16); no fan glitch at boot.
- [ ] Buzzer current within GPIO rating or transistor fitted.
- [ ] Stepper driver current set to NEMA17 rating; microstep DIP recorded; ENA per manual; VMOT range confirmed.
- [ ] Sensor/button looms routed away from motor/relay wiring.
- [ ] Photos + logs captured for the evidence package (wiring, per-floor detection, limit-switch logs).
