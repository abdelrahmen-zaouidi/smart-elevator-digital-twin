# Submission Gaps Checklist

This file tracks every placeholder and unresolved submission task in `main.tex`.

## Required Measurements

- [ ] M1 - `[MEASURE: operator action to firmware/simulator command application latency, ms -- run GAPS M1]`
  - Instrument the dashboard command route to log `t_api_received`, `t_gate_done`, `t_ditto_write_done`.
  - Add bridge log timestamps for `t_intent_seen` and `t_mqtt_published`.
  - Add firmware or simulator acknowledgement timestamp `t_command_received` and `t_command_applied`.
  - Run at least 30 commands over the final stack and report median, p95, min, max, and sample count.

- [ ] M2 - `[MEASURE: MQTT RTT, ms over TLS and local broker -- run GAPS M2]`
  - Write a script that publishes a timestamped JSON message to a permitted telemetry test topic over TLS and waits for the subscribed echo or paired response.
  - Use synchronized system time and run at least 100 iterations.
  - Report median, p95, min, max, packet loss/timeouts, broker host, port, QoS, and payload size.

- [ ] M3 - `[MEASURE: MQTT publish to Ditto feature update delay, ms -- run GAPS M3]`
  - Publish telemetry with a unique `measurement_id` and `sent_at`.
  - Subscribe to Ditto SSE or poll `/api/2/things/{thingId}` until the same `measurement_id` appears.
  - Compute `t_ditto_seen - t_mqtt_publish`.
  - Run at least 50 samples and report median and p95.

- [ ] M4 - `[MEASURE: safety-gate decision time, ms -- run GAPS M4]`
  - Add a microbenchmark around `validateCommand(...)` in `packages/shared/commandSafetyGate.js`.
  - Test accepted and rejected command classes with representative twin snapshots.
  - Run at least 1000 iterations per class and report median, p95, and worst-case values.
  - Keep the existing 33/33 assertion count as functional validation, not latency.

- [ ] M5 - Optional telemetry jitter measurement.
  - Subscribe to `elevator/{id}/telemetry`, record arrival timestamps for at least 10 minutes, and compute inter-arrival mean, standard deviation, min, max, and p95.
  - Run once with simulator and once with the physical ESP32-S3 if available.

- [ ] M6 - `[MEASURE: Wi-Fi/MQTT/broker reconnection time, s -- run GAPS M6]`
  - Run controlled broker stop/start and Wi-Fi interruption tests.
  - Record last good telemetry/status, disconnect detection, reconnect, and first valid telemetry after recovery.
  - Report separate broker-restart and Wi-Fi-loss recovery times.

- [ ] M7 - `[MEASURE: live dispatch decision time, ms -- run GAPS M7]`
  - Add timestamps around context fetch, Brain A decision, Brain B shadow decision, gate preview, `/api/commands` post, and dispatch log insert.
  - Run the dispatch engine in `--once` mode over at least 50 stored or synthetic contexts.
  - Report active Brain A decision time separately from full loop time.

- [ ] M8 - `[MEASURE: ESP32 free heap, stack watermark, loop timing, and MQTT/TLS memory -- run GAPS M8]`
  - Add serial telemetry for free heap before Wi-Fi, after TLS connect, after MQTT connect, during idle, during motion, and after command receipt.
  - If using Arduino, capture `ESP.getFreeHeap()` and loop timing; if available, include stack high-water marks from the runtime.
  - Run a 30-minute stability session and archive the serial log.

- [ ] M9 - Instrumented physical travel timing.
  - Record a video or serial/MQTT log with timestamps for adjacent-floor motion start and arrival.
  - Repeat at least 10 runs in both directions.
  - Report mean, standard deviation, min, and max; keep the current `~6 s` value labeled as author-recorded until this is complete.

## Citation and Metadata Tasks

- [ ] Add author e-mail addresses in `main.tex`.
- [ ] Add ORCID identifiers if the target journal requires them.
- [ ] Verify target journal author-name order and whether "Pr." should be omitted from the author line. Current journal-style draft uses `Mounir Bouhedda`.
- [ ] No `[VERIFY CITATION]` placeholders were inserted. All references in `references.bib` are seeded from the thesis bibliography, with BibTeX-compatible entry types.
- [ ] Before submission, verify URLs and access dates for web documentation references if the selected journal requires access dates.

## Figure Tasks

- [ ] Export the command-path figure as vector artwork if the journal does not accept the native LaTeX figure.
- [ ] Regenerate the global architecture figure from `docs/features/global-synoptic-architecture-*.svg`.
- [ ] Decide whether to include the prototype overview photograph within the page budget.
- [ ] Regenerate the Ditto Thing model as a compact two-column-friendly vector figure.
- [ ] Export a clean dashboard command-center screenshot with no secrets or localhost credentials.
- [ ] Export an n8n workflow diagram from the final workflow version.

## Section Tasks Needing Author Input

- [ ] Confirm exact author emails, affiliations, and corresponding-author designation.
- [ ] Add funding, grant, or acknowledgment text if applicable.
- [ ] Decide target journal and adapt class/style after IEEEtran draft stabilizes.
- [ ] Confirm whether to publish a sanitized repository artifact or a private supplementary package.
- [ ] Provide final hardware evidence if the paper should claim physical RFID, KY-024 floor confirmation, SPDT door confirmation, calibrated load, real temperature, or real vibration validation.
