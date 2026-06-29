# Performance measurement harness (paper GAPS M1–M9)

Scripts and instructions to produce the quantitative metrics the paper labels as
measured vs. future work. **No fabricated numbers** — each metric is either
produced by running real code here, or is left as a ready-to-run procedure that
needs the live stack or the physical board.

| ID | Metric | Status | How |
|----|--------|--------|-----|
| M4 | Safety-gate decision time | **runnable now** | `node scripts/validation/bench-decision-latency.mjs` |
| M7 | Dispatch (Brain A) decision time | **runnable now** | same script |
| —  | Cost of safety (in-process) | **runnable now** | same script |
| M2 | MQTT RTT (local + TLS) | needs broker | see below (one Docker container) |
| M1 | End-to-end command latency | needs full stack | instructions below |
| M3 | MQTT→Ditto sync delay | needs full stack | instructions below |
| M6 | Reconnection time | needs stack + fault injection | instructions below |
| M8 | ESP32 heap/stack/loop/TLS memory | needs physical board | `esp32_resource_probe.h` |
| M9 | Instrumented adjacent-floor travel time | needs physical board | instructions below |

Canonical outputs live in `evidence/perf/`.

---

## M4 / M7 / cost of safety — runnable now (no prototype, no stack)

```bash
node scripts/validation/bench-decision-latency.mjs --json evidence/perf/decision-latency.json
```
Reports median/mean/p95/p99/min/max/stddev over 20k samples per class for the
deterministic safety gate and the active Brain A dispatch decision, plus the
in-process admission overhead vs. a direct dashboard→MQTT serialization. These
are **CPU times of the decision logic**, not end-to-end or test-suite times.

## M2 — MQTT round-trip time (one throwaway broker)

A throwaway broker is enough (this measures transport, not auth). Stage the
config and certs in one directory (single-file mounts are unreliable on Docker
Desktop/Windows, and the key must be readable by the broker's `mosquitto` user):
```bash
D="$PWD/.rtt-broker"; mkdir -p "$D"
cp scripts/validation/rtt-test.conf "$D/mosquitto.conf"
cp infra/mqtt/certs/ca.crt infra/mqtt/certs/server.crt infra/mqtt/certs/server.key "$D/"
chmod 644 "$D"/*
docker run -d --name mqtt-rtt-test -p 18831:1883 -p 18883:8883 \
  -v "$D:/mosquitto/config" eclipse-mosquitto:2.0.18
node scripts/validation/bench-mqtt-rtt.mjs        # writes evidence/perf/mqtt-rtt.txt
docker rm -f mqtt-rtt-test; rm -rf "$D"
```
Captured here (loopback, i7-8665U): local TCP median 1.11 ms, TLS 8883 median
1.19 ms (500 samples each); see `evidence/perf/mqtt-rtt.txt`.

## M1 — end-to-end command latency (full stack + simulator/firmware)

Bring up the stack (`docker compose up -d`) and the authenticated simulator.
Instrument these timestamps and join on `command_id`/`correlation_id`:
1. `apps/dashboard/app/api/commands/route.js`: log `t_api_received`, `t_gate_done`,
   `t_ditto_write_done`.
2. `services/ditto-bridge/bridge.js`: log `t_intent_seen`, `t_mqtt_published`.
3. Device endpoint (`services/simulator/esp32_simulator.py` or firmware):
   `t_command_received`, `t_command_applied`.
Run ≥30 commands; report median, p95, min, max, N for
`t_command_applied − t_api_received`. Use one synchronized clock (single host).

## M3 — MQTT→Ditto synchronization delay

Publish telemetry carrying a unique `measurement_id` + `sent_at`; subscribe to
Ditto SSE (or poll `/api/2/things/{thingId}`) until the same `measurement_id`
appears; record `t_ditto_seen − t_mqtt_publish`. ≥50 samples; report median, p95.

## M6 — reconnection time (fault injection)

With the stack live, run controlled `docker stop mosquitto && docker start
mosquitto` (broker loss) and a Wi-Fi drop on the board. Log last good
telemetry, disconnect detection, reconnect, and first valid telemetry after
recovery. Report broker-restart and Wi-Fi-loss recovery separately (seconds).

## M8 — ESP32 heap / stack / loop / TLS memory (physical board)

Use `esp32_resource_probe.h` (drop-in). Add `m8_mark(...)` at boot / after
Wi-Fi / after TLS / after MQTT / after a command, and `m8_loop_tick()` as the
first line of `loop()`. Flash, run ≥30 min (idle + moves + a command burst),
capture serial to `evidence/perf/esp32-resources.txt`, then:
```bash
node scripts/measurement/summarize_esp32.mjs evidence/perf/esp32-resources.txt
```
Report minimum free heap, idle vs. moving vs. post-TLS heap, stack head-room,
and loop period (median/p95/max).

## M9 — instrumented adjacent-floor travel time (physical board)

Log a serial/MQTT timestamp at motion start and at arrival (KY-024 / arrival
event) for ≥10 runs in each direction. Report mean, stddev, min, max. Until
then the paper keeps `~6 s` labeled as author-recorded.
