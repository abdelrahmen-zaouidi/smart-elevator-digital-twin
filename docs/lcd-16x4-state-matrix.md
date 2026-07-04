# LCD 16x4 state matrix

All production rows begin at column `0`. Shorter text is padded only on the
right, so every row still overwrites exactly 16 cells and cannot leave stale
characters. In the table below, `·` represents one trailing space.

The centering helper remains available for explicitly requested future screens,
but it is not used by the current production state matrix.

| State | Row 1 | Row 2 | Row 3 | Row 4 |
|---|---|---|---|---|
| Booting | `SMART·ELEVATOR··` | `ESP32-S3········` | `BOOTING·········` | `PLEASE·WAIT·····` |
| Wi-Fi connecting | `CONNECTING······` | `WI-FI···········` | `NETWORK·START···` | `PLEASE·WAIT·····` |
| Wi-Fi failure | `WI-FI·FAILED····` | `CHECK·NETWORK···` | `RETRY·ACTIVE····` | `LOCAL·MODE······` |
| MQTT connecting | `CONNECTING······` | `MQTT·BROKER·····` | `SECURE·LINK·····` | `PLEASE·WAIT·····` |
| MQTT reconnecting | `MQTT·RECONNECT··` | `LINK·LOST·······` | `RETRY·ACTIVE····` | `CONTROL·LOCAL···` |
| Ditto/backend unavailable | `BACKEND·OFFLINE·` | `DITTO·UNAVAIL···` | `MQTT·CONNECTED··` | `CONTROL·LOCAL···` |
| Idle | `SYSTEM·READY····` | `CABIN·IDLE······` | `DOOR·CLOSED·····` | `SELECT·FLOOR····` |
| Cabin at floor | `CABIN·POSITION··` | `AT·FLOOR·2······` | `DOOR·CLOSED·····` | `SYSTEM·READY····` |
| Moving up | `MOVING·UP·······` | `FLOOR·1·TO·3····` | `DOOR·LOCKED·····` | `PLEASE·WAIT·····` |
| Moving down | `MOVING·DOWN·····` | `FLOOR·3·TO·0····` | `DOOR·LOCKED·····` | `PLEASE·WAIT·····` |
| Arriving | `ARRIVING········` | `FLOOR·3·········` | `STOPPING········` | `PLEASE·WAIT·····` |
| Door opening | `DOOR·OPENING····` | `AT·FLOOR·3······` | `STAND·CLEAR·····` | `PLEASE·WAIT·····` |
| Door open | `DOOR·OPEN·······` | `AT·FLOOR·3······` | `ENTER·OR·EXIT···` | `CLOSE·SOON······` |
| Door closing | `DOOR·CLOSING····` | `AT·FLOOR·3······` | `STAND·CLEAR·····` | `PLEASE·WAIT·····` |
| Floor selected | `FLOOR·SELECTED··` | `TARGET·FLOOR·3··` | `REQUEST·QUEUED··` | `PLEASE·WAIT·····` |
| Command accepted | `CMD·ACCEPTED····` | `REMOTE·CONTROL··` | `SAFETY·CLEAR····` | `EXECUTING·······` |
| Command completed | `CMD·COMPLETED···` | `DEVICE·CONFIRMED` | `STATE·UPDATED···` | `SYSTEM·READY····` |
| Command failed | `COMMAND·FAILED··` | `DEVICE·ERROR····` | `CHECK·SYSTEM····` | `RETRY·SAFELY····` |
| Command timeout | `COMMAND·TIMEOUT·` | `NO·DEVICE·ACK···` | `STATE·UNKNOWN···` | `CHECK·SYSTEM····` |
| Card required | `CARD·REQUIRED···` | `RESTRICTED·FLOOR` | `SCAN·RFID·TAG···` | `ACCESS·PENDING··` |
| Card accepted | `CARD·ACCEPTED···` | `ACCESS·GRANTED··` | `REQUEST·ACTIVE··` | `PLEASE·WAIT·····` |
| Card rejected | `CARD·REJECTED···` | `ACCESS·DENIED···` | `CHECK·CARD······` | `TRY·AGAIN·······` |
| Dashboard authorized | `REMOTE·AUTH·OK··` | `SCADA·OPERATOR··` | `POLICY·VERIFIED·` | `REQUEST·ACTIVE··` |
| Invalid floor | `INVALID·FLOOR···` | `VALID·RANGE·0-3·` | `REQUEST·REJECT··` | `CHECK·COMMAND···` |
| Overload | `OVERLOAD········` | `MOVEMENT·BLOCK··` | `REDUCE·LOAD·····` | `THEN·RETRY······` |
| Obstruction | `OBSTRUCTION·····` | `DOOR·BLOCKED····` | `CLEAR·OPENING···` | `STAND·CLEAR·····` |
| Emergency stop | `EMERGENCY·STOP··` | `SYSTEM·HALTED···` | `MOTION·LOCKED···` | `RESET·REQUIRED··` |
| Maintenance mode | `MAINT·MODE······` | `SERVICE·ACTIVE··` | `CALLS·DISABLED··` | `TECHNICIAN·ONLY·` |
| Sensor fault | `SENSOR·FAULT····` | `MOTION·LOCKED···` | `CHECK·WIRING····` | `SERVICE·REQUIRED` |
| Communication fault | `COMMS·FAULT·····` | `LINK·UNAVAILABLE` | `CONTROL·LOCAL···` | `CHECK·NETWORK···` |

The executable source of truth is `packages/shared/lcd16x4.js`. Validation
fails if any screen has other than four rows, any row has other than 16 cells,
or any production row begins with a space.
