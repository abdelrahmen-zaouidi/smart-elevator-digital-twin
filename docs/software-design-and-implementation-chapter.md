# Chapter X: Software Design and Implementation

> **Update note (2026-06-03).** This chapter was written against an earlier
> inspection. Two facts have since changed and the following are authoritative:
> the **MQTT broker is now authenticated, ACL-enforced, and TLS-secured on the
> ESP32 hop** (anonymous access is disabled — see [SECURITY.md](../SECURITY.md)
> and the [MQTT reference](mqtt-reference.md)); and the **command path is wired
> end to end** (dashboard intent → Ditto `control/pending_command` → bridge MQTT
> fanout). A dual-brain [AI-Adaptive Dispatch Policy Engine](features/adaptive-dispatch-engine.md)
> and the `microcontroller` + `control` Ditto features were also added; the full
> 12-feature surface is in the [Ditto twin reference](ditto-twin-reference.md).

## Preliminary Codebase-Based Analysis

### A. Summary of the Current Project Architecture

The inspected project implements a local smart-elevator Digital Twin platform composed of a simulator layer, an MQTT communication layer, a Digital Twin synchronization layer, a web-based SCADA dashboard, n8n automation workflows, and supporting local deployment assets. The main operational flow represented in the codebase is:

```text
Python or ESP8266 simulator -> Mosquitto MQTT -> Node bridge and/or n8n -> Eclipse Ditto -> Next.js dashboard
Dashboard commands -> Ditto REST API -> Digital Twin desired state -> future device command execution
```

The simulator layer is implemented primarily in `esp32_simulator.py`, with an additional embedded sketch in `ELEVATOR_SIMULATOR_ESP8266/ELEVATOR_SIMULATOR_ESP8266.ino`. The Python simulator models elevator motion, door states, motor temperature, vibration, RFID access, passenger load, emergency events, and incident logs. It serializes the state as an Eclipse Ditto-style MQTT envelope and publishes it to Mosquitto. The Arduino/ESP8266 sketch follows the same conceptual payload structure, although it currently contains hardcoded network settings that should be moved to a safer configuration mechanism before physical deployment.

Mosquitto is configured with a TCP listener on port `1883` and a WebSocket listener on port `9001`. The project now uses a single canonical MQTT topic convention: `elevator/{mqtt_safe_thing_id}/{telemetry|events|commands|status}`. The Ditto Thing ID `building:floor1:elevator` is preserved unchanged; inside MQTT topic segments the safe form `building-floor1-elevator` is used (`:` -> `-`). The Python and embedded simulators publish to `elevator/{mqtt_safe_thing_id}/telemetry`. The bridge and dashboard subscribe fleet-wide with the single-level wildcard pattern `elevator/+/{telemetry|events|status}`. Legacy patterns such as `elevator/telemetry/{thingId}`, `elevator/telemetry/+`, and `elevator/telemetry/#` are deprecated; the bridge still accepts `MQTT_TOPIC` overrides for backwards compatibility, but no first-class component publishes or subscribes to them by default.

The Digital Twin synchronization is handled by Eclipse Ditto through the Ditto HTTP API path pattern `/api/2/things/{thingId}`. The Node bridge in `services/ditto-bridge/bridge.js` subscribes to MQTT, normalizes telemetry payloads, maps field aliases into Ditto feature properties, and writes feature or attribute updates to Ditto with retry logic and duplicate-write suppression. The active dashboard component, `apps/dashboard/components/ElevatorOS.jsx`, reads from live MQTT and Ditto state through custom hooks and sends operator commands through the Ditto REST API proxy.

The dashboard is a Next.js application using React, Tailwind CSS, Recharts, Lucide icons, and local UI components. The active page entry is `apps/dashboard/app/page.tsx`, which renders `ElevatorOS`. This component includes Digital Twin, Monitoring, Control, Analytics, Alerts, Logs, Devices/Sensors, Reports, Settings, and Help/About pages. The codebase also contains older or reusable SCADA components under `apps/dashboard/components/scada`, but the active route uses the monolithic `ElevatorOS.jsx` implementation.

The AI automation layer is represented by exported n8n workflows and Code-node scripts. The workflows include ingestion/surveillance, analysis, control, security and maintenance, notification, optimization, and audit agents. The design uses deterministic rule-based analysis as the authority for risk and control decisions, with optional local Ollama LLM support for explanatory analysis only. PostgreSQL/TimescaleDB tables support telemetry archiving, audit logs, notification outbox records, control command logs, maintenance work orders, and system health history.

Local deployment is managed by `docker-compose.yml`, which defines Mosquitto, n8n, TimescaleDB/PostgreSQL, optional Ollama, optional Adminer, and optional Grafana. Eclipse Ditto itself is not defined in this Compose file; the configuration expects an external Ditto deployment reachable through the external Docker network `docker_default` and service name `docker-nginx-1`. The dashboard is also not defined as a Compose service and is expected to run separately with the Next.js development or production scripts.

Validation performed during this analysis:

- `node tools\validate_n8n_upgrade_package.js` completed successfully and validated workflow JSON connections and Code-node script syntax.
- `npx tsc --noEmit` completed successfully inside the `dashboard` directory.
- Runtime files show a recent `runtime/live-twin.json` snapshot and bridge logs indicating repeated Ditto synchronization from MQTT.

### B. Proposed Chapter Outline

1. Introduction
2. Software Architecture Overview
3. Technology Stack
4. Simulator Layer
5. Communication Layer
6. Digital Twin Layer
7. Dashboard Layer
8. API and Service Layer
9. AI Automation Layer
10. Docker and Deployment
11. Security and Access Control
12. Software Implementation Details
13. Testing and Validation
14. Limitations
15. Conclusion

### C. Missing Information or Unclear Elements

1. Eclipse Ditto deployment files are not present in this repository. The project assumes an existing Ditto stack reachable through `http://docker-nginx-1` inside Docker or `http://localhost` from the host.
2. Ditto policy definitions are not included in the repository. Therefore, policy enforcement can be discussed architecturally, but concrete project policies cannot be described as implemented unless they exist in the external Ditto deployment.
3. The root `docker-compose.yml` mounts the `./infra/mqtt` directory at `/mosquitto/config` and starts the broker with `elevator.conf` (authenticated, ACL-enforced, with TLS on the ESP32 listener). The earlier stale duplicate at `mosquitto/infra/mqtt/mosquitto.conf` has been removed; see [SECURITY.md](../SECURITY.md) and the [MQTT reference](mqtt-reference.md).
4. The dashboard and Eclipse Ditto are not defined as services in the inspected Compose file. The chapter should describe the deployment as a partially containerized local stack unless additional Compose files exist elsewhere.
5. The project request mentions Framer Motion, but `framer-motion` is not present in `apps/dashboard/package.json` and no imports were found. The dashboard currently uses CSS, Tailwind animation utilities, and SVG animation instead.
6. The n8n ingestion workflow currently polls Ditto on a schedule. This is functional for a local thesis system, but an event-driven Ditto events or MQTT-triggered workflow would be more appropriate for production.
7. MQTT topics are now standardised on the canonical convention `elevator/{mqtt_safe_thing_id}/{telemetry|events|commands|status}` across the simulator, bridge, dashboard, and Docker Compose configuration. The Ditto Thing ID is unchanged; topic segments use the safe form (e.g. `building-floor1-elevator`).
8. The login/logout mechanism is a frontend local session stored in browser storage. It is not yet a production identity provider or role-based access control system.
9. The embedded ESP8266 sketch contains hardcoded Wi-Fi and broker configuration. These values should be externalized before real device deployment.
10. Physical validation with a real elevator installation is not represented in the repository; the current system is primarily simulator-driven.

## 1. Introduction

This chapter presents the software design and implementation of the Agentic AI Smart Elevator Management System developed around a Digital Twin architecture. The objective is to explain how the software components cooperate to emulate, monitor, analyze, and control a smart elevator system. The chapter focuses on the software layers implemented in the project repository, including the elevator simulator, MQTT communication, Eclipse Ditto synchronization, SCADA dashboard, n8n automation workflows, local Docker deployment, and supporting API and data services.

The software is central to the project because it connects the simulated or embedded elevator device to a structured Digital Twin representation. Instead of allowing the user interface to consume raw device data directly, the system uses MQTT as the ingestion layer and Eclipse Ditto as the operational source of truth. This design separates device communication, Digital Twin state management, operator visualization, and automation logic. The result is a modular architecture that can support local experimentation while preserving a structure suitable for extension to multiple elevators and buildings.

The chapter avoids presenting the system as a fully industrial-certified product. It describes what is implemented in the repository and distinguishes current limitations from future improvements. In particular, the current system demonstrates a strong local prototype for a thesis-level Digital Twin platform, but production deployment would require stronger authentication, standardized MQTT topics, physical validation, externalized embedded configuration, and complete Ditto policy management.

**Suggested Figure X.1: Global Software Architecture.** Caption: Overall data flow from simulator or embedded controller to MQTT, bridge or n8n processing, Eclipse Ditto synchronization, dashboard visualization, and command feedback through Ditto.

## 2. Software Architecture Overview

The project follows a layered architecture. At the bottom layer, the elevator is represented either by a Python simulator or by an ESP8266-based embedded simulator. This layer produces telemetry describing the current state of the elevator, such as floor position, target floor, door state, motor temperature, vibration level, passenger load, RFID status, alert level, and incident history.

The communication layer uses MQTT through Mosquitto. MQTT decouples telemetry producers from consumers and allows the simulator, bridge, dashboard, and automation workflows to communicate through lightweight JSON messages. In the inspected implementation, telemetry is published as a Ditto-compatible envelope containing a `topic`, `headers`, `path`, and `value`. This envelope can be normalized and written into Eclipse Ditto as feature or attribute updates.

Eclipse Ditto forms the Digital Twin layer. The elevator state is represented as a Ditto Thing, identified by the default thing ID `building:floor1:elevator`. The Thing contains attributes, such as location, system mode, risk score, and health indicators, and features such as `cabin`, `door`, `motor`, `security`, `incident_log`, `energy`, `performance`, and `predicted_failures`. The dashboard and automation workflows interact with Ditto rather than treating MQTT as the primary user-interface data source.

The dashboard layer is a Next.js application that provides SCADA-style monitoring and control. It visualizes the Digital Twin state, shows telemetry charts, exposes command controls, displays alerts and logs, and includes a local simulation mode. The active dashboard implementation reads live MQTT messages and Ditto updates through hooks, but operator commands are implemented through Ditto API calls such as feature and attribute updates.

The automation layer is implemented through n8n workflows. These workflows represent separate agents for ingestion, analysis, control, security, maintenance, notification, optimization, and audit. The design uses deterministic rules for safety-critical decisions and optional local LLM support through Ollama for explanatory analysis only. PostgreSQL/TimescaleDB supports historical telemetry storage, auditability, notification reliability, and predictive maintenance records.

**Table X.1: Main Software Layers**

| Layer | Main files or services | Responsibility |
|---|---|---|
| Simulator | `esp32_simulator.py`, `ELEVATOR_SIMULATOR_ESP8266.ino` | Generate elevator telemetry and anomalies |
| Communication | Mosquitto, `mqttClient.js`, `bridge.js` | Transport JSON telemetry and normalize MQTT messages |
| Digital Twin | Eclipse Ditto API, `dittoApi.js`, `useDitto.js` | Store and expose authoritative twin state |
| Dashboard | `app/page.tsx`, `components/ElevatorOS.jsx` | Operator visualization, alerts, and commands |
| Automation | `workflows/n8n/*.json`, Code-node scripts | AI/rule-based analysis, control routing, maintenance, notifications |
| Persistence | TimescaleDB/PostgreSQL migrations | Telemetry history, audit logs, outbox, work orders |
| Deployment | `docker-compose.yml`, `.env.example` | Local service orchestration and configuration |

## 3. Technology Stack

The system uses a combination of IoT, web, automation, and data technologies. The selection reflects the need to combine real-time telemetry ingestion, Digital Twin abstraction, web-based supervision, workflow automation, and reproducible local deployment.

**Table X.2: Technology Stack and Project Role**

| Technology | Role in the project | Rationale |
|---|---|---|
| Python | Main simulator in `esp32_simulator.py` | Allows rapid development of a realistic elevator state machine, physics model, anomaly injection, and MQTT publishing |
| ESP8266/Arduino C++ | Embedded simulator sketch | Provides a path toward hardware-like telemetry publishing using Wi-Fi, PubSubClient, and ArduinoJson |
| MQTT | Telemetry transport protocol | Lightweight publish/subscribe protocol suitable for IoT and low-overhead sensor communication |
| Mosquitto | MQTT broker | Provides local MQTT TCP and WebSocket listeners for simulator, bridge, and dashboard communication |
| Eclipse Ditto | Digital Twin platform | Represents the elevator as a structured Thing with attributes and features |
| React and Next.js | Dashboard framework | Supports a browser-based SCADA interface, API routes, and structured component development |
| Tailwind CSS | Styling system | Provides utility-based styling and theme tokens for the industrial dashboard UI |
| Recharts | Telemetry charting | Used for vibration, temperature, load, energy, and trend visualizations |
| CSS/Tailwind animation | UI animation | The current implementation uses CSS, SVG animation, and Tailwind animation utilities; Framer Motion is not currently implemented |
| n8n | Automation orchestration | Implements multi-agent workflows for surveillance, analysis, control, maintenance, security, notifications, optimization, and audit |
| PostgreSQL/TimescaleDB | Historical and operational storage | Stores telemetry, audit logs, notification outbox, control commands, work orders, and health history |
| Docker Compose | Local deployment | Runs Mosquitto, n8n, TimescaleDB, and optional local tools reproducibly |
| REST API | Ditto and dashboard service access | Used for Thing retrieval, feature updates, attribute updates, and command state updates |
| Server-Sent Events and WebSocket | Real-time communication where applicable | Ditto SSE is supported by the hook but disabled by default; MQTT over WebSocket is used by the browser client |
| Ollama | Optional local LLM runtime | Provides local AI explanations when enabled, without depending on paid cloud APIs |

## 4. Simulator Layer

The simulator layer replaces the real elevator hardware during development. Its purpose is not only to generate random values, but to emulate an elevator as a stateful cyber-physical process. The Python simulator defines an elevator state machine with phases such as idle, door closing, accelerating, cruising, decelerating, door opening, door dwell, emergency stop, and maintenance. It models floor-to-floor movement, acceleration and deceleration, door dwell time, thermal behavior of the motor, vibration levels, passenger load, RFID access, and incident logging.

The generated telemetry includes the current floor, target floor, direction, speed, cabin load, cabin temperature, door state, forced-entry status, motor vibration, motor hours, motor health, motor temperature, audio distress state, RFID status, unauthorized access attempts, and alert level. The simulator also maintains an `incident_log` feature containing recent incidents and the number of open incidents.

The Python simulator publishes telemetry through Paho MQTT. It uses environment variables for host-facing configuration, including `MQTT_HOST`, `MQTT_PORT`, `THING_ID`, `MQTT_TELEMETRY_TOPIC` (or the legacy `MQTT_TOPIC` override), `MQTT_EVENTS_TOPIC`, `MQTT_COMMANDS_TOPIC`, `MQTT_STATUS_TOPIC`, and `PUBLISH_INTERVAL_S`. When the topic variables are absent, the simulator derives canonical defaults from the Thing ID using the helper `build_telemetry_topic(thing_id)` (and its `events` / `commands` / `status` siblings). It also writes the latest simulated twin snapshot to `runtime/live-twin.json`, which is useful for local debugging and evidence of current simulator output. The MQTT payload is built as a Ditto envelope with `path: "/features"` and a `value` containing the feature tree.

The embedded sketch mirrors the Python simulator concept using ESP8266 Wi-Fi, PubSubClient, and ArduinoJson. It includes the same general categories of telemetry and can publish either a Ditto-style envelope or a raw twin patch. However, this sketch currently contains hardcoded Wi-Fi and broker configuration. For production or laboratory demonstrations involving real hardware, these values should be moved to a secure configuration mechanism and should not be committed directly in source code.

**Table X.3: Main Simulator Telemetry**

| Category | Example fields | Purpose |
|---|---|---|
| Cabin | `current_floor`, `target_floor`, `direction`, `load_kg`, `speed_ms`, `emergency_stop` | Represents movement, occupancy, and safety state |
| Door | `state`, `door_forced_entry`, `cycle_count`, `obstruction_events` | Supports door safety and security monitoring |
| Motor | `vibration_level`, `hours_operated`, `health_status`, `temperature_c`, `current_draw_a`, `power_kw` | Supports predictive maintenance and energy analysis |
| Security | `audio_distress_active`, `rfid_last_card`, `rfid_access_granted`, `unauthorized_access_attempts`, `alert_level` | Supports access control and emergency detection |
| Incident log | `entries`, `open_incidents` | Maintains operational event history |
| Energy and performance | `kwh_today`, `availability_pct`, `avg_wait_s`, `door_cycle_efficiency` | Supports dashboard and optimization workflows |

## 5. Communication Layer

The communication layer uses MQTT as the ingestion protocol. MQTT is suitable for IoT systems because it is lightweight, supports publish/subscribe decoupling, and can operate over unreliable networks with reconnect behavior. In this project, the simulator publishes JSON telemetry to Mosquitto, and consumers such as the bridge, dashboard, and automation workflows can subscribe without tightly coupling themselves to the device implementation.

The Mosquitto configuration exposes a TCP listener on port `1883` and a WebSocket listener on port `9001`. The WebSocket listener allows the browser-based dashboard to connect to MQTT through the `mqtt` JavaScript client. The broker (`infra/mqtt/elevator.conf`) requires authentication, enforces per-identity ACLs, and offers TLS on the ESP32-facing listener (8883); anonymous access is disabled. (This corrects the earlier development configuration — see [SECURITY.md](../SECURITY.md).)

The Node bridge subscribes to configured topics, normalizes telemetry, and writes the resulting state to Ditto. The dashboard MQTT client subscribes to the configured topic patterns and updates local UI state when live telemetry is available. However, according to the architecture, MQTT should remain the ingestion layer, while Ditto remains the authoritative state layer.

**Table X.4: Canonical MQTT Topic Convention**

| Topic | Direction | Used by | Notes |
|---|---|---|---|
| `elevator/{mqtt_safe_thing_id}/telemetry` | Device -> cloud | Python simulator, ESP8266 sketch (publish); bridge and dashboard (subscribe via `elevator/+/telemetry`) | Primary periodic state update topic |
| `elevator/{mqtt_safe_thing_id}/events` | Device -> cloud | Discrete safety, security, and maintenance events | Reserved publisher topic; subscribers join via `elevator/+/events` |
| `elevator/{mqtt_safe_thing_id}/commands` | Cloud -> device | Dashboard command publisher (`publishCommand`) and future device-side subscribers | Per-device topic for control directives |
| `elevator/{mqtt_safe_thing_id}/status` | Device -> cloud | Heartbeat / online-offline state | Subscribed fleet-wide via `elevator/+/status` |

The Ditto Thing ID remains `building:floor1:elevator`; the MQTT-safe segment is `building-floor1-elevator` (`thing_id_to_mqtt_id(thing_id)`). Legacy patterns such as `elevator/telemetry/{thingId}`, `elevator/telemetry/+`, and `elevator/telemetry/#` are deprecated and no longer used by default by any first-class component, though the bridge still accepts an `MQTT_TOPIC` override for transitional deployments.

**Suggested Figure X.2: MQTT Communication Flow.** Caption: Simulator publishes JSON Ditto-envelope telemetry to Mosquitto; bridge, dashboard, and automation services subscribe to topic patterns; the bridge converts MQTT messages into Ditto feature and attribute writes.

## 6. Digital Twin Layer

The Digital Twin layer is based on Eclipse Ditto. In Ditto, a physical or simulated asset is modeled as a Thing. The elevator Thing is identified by `building:floor1:elevator`. It contains attributes for metadata and system-level state, and features for subsystems such as cabin, door, motor, security, incident log, energy, performance, and predicted failures.

Attributes represent state that applies to the whole elevator, such as location, system mode, risk score, maintenance priority, system health index, energy efficiency, and uptime. Features represent subsystems and contain properties. For example, the `motor` feature contains vibration level, hours operated, health status, and temperature. The `security` feature contains RFID and alert data. This separation allows clients to update specific feature paths without rewriting the complete Thing.

The project interacts with Ditto through REST paths under `/api/2/things/{thingId}`. The dashboard service functions provide `getThing`, `updateFeature`, and `updateAttributes`. The bridge writes normalized MQTT telemetry to `/features/{featureId}` and `/attributes`. The Next.js API route `app/api/ditto/[...path]/route.ts` acts as a proxy between the browser-facing dashboard and Ditto, injecting Basic Auth credentials from environment variables and forwarding GET, PUT, and POST requests.

The current repository does not include Ditto policy definitions. Therefore, the implementation demonstrates Ditto synchronization but does not provide repository-level evidence of policy design. In a production Digital Twin deployment, Ditto policies should explicitly define which principals may read telemetry, write commands, update security state, and manage policies.

**Suggested Figure X.3: Digital Twin Synchronization Flow.** Caption: MQTT telemetry is normalized into Ditto features and attributes; dashboard reads the Ditto Thing and sends commands through Ditto API updates; n8n workflows read and write Digital Twin state for analysis and control support.

## 7. Dashboard Layer

The dashboard layer is implemented as a React/Next.js SCADA-style interface. The active route is `apps/dashboard/app/page.tsx`, which renders the `ElevatorOS` component. This component acts as the main operator console and contains the Digital Twin engine, page navigation, command handlers, telemetry charts, alerts, logs, settings, and local frontend session management.

The dashboard presents operational data in a form suitable for supervision. It shows the current floor, target floor, direction, motor health, temperature, vibration, load, risk score, security alert level, and connection status. It also displays charts using Recharts, status pills, incident cards, command logs, and telemetry timelines. The UI includes pages for Digital Twin visualization, monitoring, control, analytics, alerts, logs, devices/sensors, reports, settings, and help/about.

Real-time visualization is implemented through a combination of live MQTT messages, Ditto state refresh, optional Ditto Server-Sent Events support, and a guarded integrated simulator fallback. The dashboard disables simulation controls while live MQTT or Ditto telemetry is active. This is important because it prevents local simulated values from overriding live operational values in the interface.

Operator commands, including emergency stop, lockdown, maintenance mode, reset, and target-floor commands, are sent through Ditto API functions. The dashboard also contains local simulation-only injectors for high vibration, forced entry, audio distress, invalid RFID, scenario execution, vibration, load, and motor-temperature changes. These injectors are guarded so they are used for simulation rather than live control.

**Table X.5: Main Dashboard Pages**

| Page | Purpose |
|---|---|
| Digital Twin | Shows the current Ditto-modeled elevator state, feature values, and state differences |
| Monitoring | Displays connection state, telemetry charts, and live operational metrics |
| Control Panel | Provides operator commands and simulation controls |
| Analytics | Presents risk, energy, performance, and predictive indicators |
| Alerts | Lists active critical and warning conditions |
| Logs | Combines command, telemetry, and incident history |
| Devices / Sensors | Summarizes ESP controller, MQTT topic hierarchy, and Ditto synchronization state |
| Reports | Provides report-style summaries of motor health, security, and energy |
| Settings | Stores frontend preferences, profile values, and local session settings |
| Help / About | Documents the local system architecture for the operator interface |

## 8. API and Service Layer

The API and service layer separates communication logic from dashboard presentation. The environment module `src/config/env.js` centralizes runtime configuration, including Ditto URL, proxy base path, MQTT WebSocket URL, topic patterns, thing ID, Ditto credentials, polling interval, SSE enablement, and simulation fallback.

The MQTT service `src/services/mqttClient.js` manages the browser MQTT connection. It establishes the WebSocket connection, subscribes to topic patterns, parses JSON messages, tracks connection status, handles reconnect and offline events, and notifies listeners. The `useMqtt` hook exposes this service to React components in a controlled way.

The Ditto service `src/services/dittoApi.js` wraps calls to Ditto through the dashboard proxy. It provides GET and PUT operations for Things, features, and attributes, includes Basic Auth, disables caching, and retries failed requests. The `useDitto` hook can use Server-Sent Events when enabled and otherwise falls back to REST polling. It also keeps a heartbeat polling mechanism when SSE is connected, which reduces the risk of a frozen SCADA state.

The backend bridge `services/ditto-bridge/bridge.js` is an important service component. It subscribes to MQTT topics, accepts several payload shapes, normalizes aliases such as `vibration_g` to `vibration_level` and `payload_weight_kg` to `load_kg`, extracts a Thing ID, and writes only meaningful feature or attribute updates to Ditto. It includes retry logic and skips unchanged serialized payloads per path to reduce unnecessary Ditto writes.

**Table X.6: API and Service Modules**

| Module | Inputs | Outputs | Role |
|---|---|---|---|
| `env.js` | Environment variables | Runtime configuration object | Centralizes dashboard configuration |
| `mqttClient.js` | MQTT broker URL and topic patterns | Parsed telemetry and connection status | Browser MQTT subscription service |
| `useMqtt.js` | React options and callbacks | Hook state and last message | Connects dashboard state to MQTT |
| `dittoApi.js` | Thing ID, feature path, payload | Ditto REST responses | Reads and writes Ditto Things |
| `useDitto.js` | Thing ID and polling/SSE config | Thing state, mode, error | Synchronizes dashboard with Ditto |
| `app/api/ditto/[...path]/route.ts` | Dashboard HTTP requests | Proxied Ditto responses | Server-side Ditto API proxy |
| `backend/bridge.js` | MQTT telemetry | Ditto feature/attribute writes | MQTT-to-Ditto synchronization bridge |

## 9. AI Automation Layer

The AI automation layer is implemented through n8n workflows. The design separates responsibilities into multiple agents rather than concentrating all logic in a single workflow. This separation improves maintainability and makes the system easier to extend for multi-elevator deployments.

The ingestion/surveillance agent polls Ditto, canonicalizes the Thing state, writes telemetry rows to PostgreSQL/TimescaleDB, deduplicates events, updates the behavior timeline, and routes significant events to analysis and audit. Although this is currently schedule-based, the surrounding architecture can be extended to event-driven triggers using Ditto events or MQTT-triggered webhooks.

The analysis agent computes deterministic risk using local rules. Its risk engine considers forced door entry, audio distress, unauthorized RFID, repeated access failures, vibration ratio, motor temperature, load ratio, emergency stop, door-open movement, current draw, power usage, door cycle fatigue, service hours, and behavior timeline trends. Optional Ollama integration can provide explanatory text, but the Code-node script explicitly prevents the LLM from authorizing commands or changing risk scores.

The control agent safety-gates all control actions before writing desired state to Ditto. It validates allowed commands, Thing ID, correlation ID, source agent, reason, target floor bounds, lockdown state, emergency stop state, and human approval requirements. Commands such as emergency stop, lockdown, maintenance mode, resume normal, fire recall, door hold open, and energy saving mode are converted into explicit Ditto path writes only after validation.

The security and maintenance workflows analyze RFID failures, forced door events, audio distress, combined security events, vibration degradation, motor temperature, current draw, power usage, door cycles, and operating hours. They generate security state updates and predictive maintenance work orders. The notification workflow implements an outbox model with deduplication, retry, and optional channels. The optimization and audit workflow supports predictive dispatch, energy analysis, compliance reporting, and centralized audit logging.

**Table X.7: n8n Workflow Agents**

| Workflow | Main trigger | Main role |
|---|---|---|
| `01_ingestion_surveillance_agent` | Schedule: poll Ditto every 5 seconds | Normalize twin events, archive telemetry, route analysis/audit |
| `02_analysis_ai_brain_agent` | Webhook | Deterministic risk analysis, optional local LLM explanation, action routing |
| `03_control_agent` | Webhook | Validate and transform control commands into Ditto writes |
| `04_security_maintenance_agents` | Schedule and webhooks | Security escalation and predictive maintenance |
| `05_notification_agent` | Webhook and scheduled outbox drain | Reliable notification routing and retry |
| `06_optimization_audit_agents` | Schedules and audit webhook | Predictive dispatch, energy optimization, compliance, audit |

**Suggested Figure X.4: n8n Agent Workflow Diagram.** Caption: Surveillance agent observes Ditto state, Analysis agent computes deterministic risk, Control agent validates actions, Security and Maintenance agents generate operational responses, Notification agent manages alerts, and Audit agent records decisions.

## 10. Docker and Deployment

The local deployment architecture is partially containerized. The inspected `docker-compose.yml` defines Mosquitto, n8n, TimescaleDB/PostgreSQL, optional Ollama, optional Adminer, and optional Grafana. These services are suitable for local thesis experimentation because they allow repeatable startup of the main infrastructure dependencies.

The Compose file expects an external Docker network named `docker_default`, which is also used to reach an external Eclipse Ditto stack through `docker-nginx-1`. This means Ditto is part of the overall project architecture, but its service definition is not contained in the inspected Compose file. Similarly, the Next.js dashboard is not included as a Compose service and is expected to run from the `dashboard` directory using scripts such as `npm run dev`, `npm run start`, or `node services/ditto-bridge/bridge.js`.

**Table X.8: Docker Compose Services**

| Service | Container name | Role |
|---|---|---|
| Mosquitto | `elevator-mqtt` | MQTT broker with TCP and WebSocket listeners |
| n8n | `elevator_agents` | Workflow automation and agent orchestration |
| TimescaleDB/PostgreSQL | `elevator_db` | Telemetry, audit, notification, command, and work-order storage |
| Ollama | `elevator_ollama` | Optional local LLM runtime under the `ai` profile |
| Adminer | `elevator_adminer` | Optional database administration UI under the `tools` profile |
| Grafana | `elevator_grafana` | Optional observability UI under the `observability` profile |

Containerization improves reproducibility by defining service images, ports, volumes, health checks, and environment variables. The `.env.example` file documents local runtime variables for PostgreSQL, n8n, Ditto, MQTT, dashboard settings, agent thresholds, optional local LLM support, notification channels, and observability tools.

## 11. Security and Access Control

The project includes several security-related concepts, but the current implementation should be understood as a local development system rather than a production security architecture. The dashboard implements a frontend-ready login and logout flow using local browser storage. The Settings page allows profile and preference changes, and logout clears the local session. This is useful for interface behavior, but it does not replace a backend identity provider, server-side sessions, or role-based access control.

Ditto API access is protected in the dashboard proxy using Basic Auth credentials loaded from environment variables. This avoids hardcoding Ditto credentials in dashboard logic, but the current public environment fallback values are still development defaults. Production deployment should use secret management and should avoid exposing credentials to browser-side code.

Mosquitto enforces username/password authentication and per-identity topic ACLs, with server-only TLS on the ESP32 hop (port 8883); anonymous access is disabled. Remaining production hardening (per-device X.509, TLS on the intra-Docker and WS listeners, role-separated Ditto policies, dashboard OIDC) is enumerated in [SECURITY.md](../SECURITY.md). The embedded sketch still requires security improvement because its Wi-Fi and broker settings are currently hardcoded.

The n8n workflows implement safety-oriented control logic. The Control Agent validates commands, checks target floor boundaries, blocks movement during lockdown or emergency stop, requires reasons and correlation IDs, and requires human approval for certain high-risk actions. This is an important software safety mechanism, but it should complement rather than replace proper device-side safety interlocks.

Future work should include complete Ditto policy definitions, production identity management, MQTT authentication and TLS, secure embedded provisioning, n8n credential hardening, audit retention rules, and clear separation between operator, maintenance, security, and administrator roles.

## 12. Software Implementation Details

This section summarizes the main implementation files and their role in the global system.

**Table X.9: Main Project Files and Modules**

| File or directory | Purpose | Inputs | Outputs and interactions |
|---|---|---|---|
| `esp32_simulator.py` | Main Python elevator simulator | Environment variables, internal state machine, anomaly probabilities | Publishes MQTT JSON Ditto envelopes and writes `runtime/live-twin.json` |
| `ELEVATOR_SIMULATOR_ESP8266.ino` | Embedded simulator sketch | Wi-Fi, MQTT broker, internal elevator model | Publishes similar JSON telemetry from an ESP8266-style device |
| `infra/mqtt/elevator.conf` (+ `aclfile`, `passwordfile`, `certs/`) | MQTT broker configuration | Broker startup | Authenticated + ACL-enforced; TLS on the ESP32 listener (8883) |
| `docker-compose.yml` | Local service orchestration | `.env` variables and Docker profiles | Runs Mosquitto, n8n, TimescaleDB, and optional local tools |
| `apps/dashboard/app/page.tsx` | Next.js page entry | Browser request | Renders the active `ElevatorOS` dashboard |
| `apps/dashboard/components/ElevatorOS.jsx` | Main SCADA application | Ditto state, MQTT telemetry, operator actions | Displays state, charts, alerts, logs, commands, settings, and simulation fallback |
| `apps/dashboard/src/config/env.js` | Dashboard configuration | Environment variables | Provides Ditto, MQTT, polling, SSE, and simulation settings |
| `apps/dashboard/src/services/mqttClient.js` | MQTT browser service | WebSocket broker and topic patterns | Emits parsed telemetry and connection status |
| `apps/dashboard/src/hooks/useMqtt.js` | React MQTT hook | Callback and enabled state | Provides MQTT connection state and last message |
| `apps/dashboard/src/services/dittoApi.js` | Ditto API client | Feature, attribute, and Thing requests | Sends proxied REST requests to Ditto with retries |
| `apps/dashboard/src/hooks/useDitto.js` | Ditto synchronization hook | Thing ID, polling/SSE settings | Provides Thing state and connection status to the dashboard |
| `apps/dashboard/app/api/ditto/[...path]/route.ts` | Next.js Ditto proxy | Browser GET/PUT/POST requests | Forwards requests to Ditto with Basic Auth and error handling |
| `services/ditto-bridge/bridge.js` | MQTT-to-Ditto bridge | MQTT JSON messages | Normalizes telemetry and writes Ditto features/attributes |
| `workflows/n8n/*.json` | Workflow exports | Webhooks, schedules, Ditto responses, database rows | Implements agent orchestration for analysis, control, maintenance, security, notification, audit |
| `workflows/n8n/enterprise-upgrade-code/*.js` | n8n Code-node logic | Workflow JSON input items and environment variables | Risk scoring, action routing, command validation, maintenance scoring, notifications, audit normalization |
| `infra/postgres/init/001_timescaledb.sql` | Initial database schema | PostgreSQL startup | Creates telemetry, audit, outbox, and continuous aggregates |
| `infra/postgres/migrations/002_enterprise_iot_upgrade.sql` | Upgrade migration | Existing PostgreSQL schema | Adds correlation IDs, command logs, work orders, system health history, indexes |
| `scripts/validate_n8n_upgrade_package.js` | Workflow validation script | Workflow JSON and Code-node scripts | Validates node references and Code-node syntax |
| `scripts/apply_n8n_enterprise_upgrade.js` | Workflow update script | Workflow files and Code-node scripts | Applies workflow upgrades and endpoint expressions |
| `scripts/start_dashboard_bridge.ps1` | Bridge startup helper | Local environment values | Starts the Node bridge with local MQTT and Ditto settings |

The implementation demonstrates a clear separation of concerns. The simulator generates telemetry; MQTT transports telemetry; the bridge writes normalized state to Ditto; Ditto stores the current twin state; the dashboard reads and commands through Ditto; n8n workflows analyze, route, notify, and audit; PostgreSQL persists historical and operational records.

## 13. Testing and Validation

Testing this system requires validating both individual components and cross-layer data flow. The repository contains a validation script for n8n workflow exports, and the dashboard can be checked through TypeScript compilation. During this analysis, the n8n validation script completed successfully and `npx tsc --noEmit` completed successfully inside the dashboard.

**Table X.10: Recommended Testing Scenarios**

| Test category | Method | Expected result |
|---|---|---|
| MQTT message testing | Publish sample JSON payloads to Mosquitto topics | Bridge and dashboard parse valid payloads and reject invalid JSON with logged errors |
| Simulator validation | Run `esp32_simulator.py` with local Mosquitto | Telemetry appears on MQTT, `runtime/live-twin.json` updates, and payload matches Ditto feature structure |
| Ditto synchronization | Run bridge and inspect Ditto Thing | Feature and attribute values update under `/api/2/things/{thingId}` |
| Dashboard visualization | Start Next.js dashboard | Pages render without hydration errors, charts update, and status indicators reflect connection state |
| Command control | Trigger emergency stop, lockdown, maintenance, reset, and target-floor commands | Dashboard sends Ditto API updates and records command log entries |
| API proxy testing | Use Postman or curl against `/api/ditto/api/2/things/{thingId}` | Proxy forwards requests and returns Ditto responses or structured upstream errors |
| n8n workflow testing | Import workflows and trigger webhooks/schedules | Agents generate canonical events, risk analysis, command validations, notifications, and audit rows |
| Database testing | Inspect TimescaleDB tables and indexes | Telemetry, audit, notification, command, work-order, and health records are persisted |
| Docker service testing | Run Compose services and check health | Mosquitto, n8n, and PostgreSQL start with expected ports and volumes |
| Security testing | Attempt invalid commands and unauthorized MQTT access | Control Agent rejects invalid commands; future work should harden MQTT authentication |

A complete validation plan should include end-to-end tests where a simulator anomaly is published to MQTT, synchronized into Ditto, detected by n8n analysis, reflected in the dashboard, and recorded in PostgreSQL audit tables. Physical validation with real elevator hardware remains outside the current repository evidence.

## 14. Limitations

The first limitation is that the deployment is local and partially containerized. Mosquitto, n8n, PostgreSQL, and optional tools are defined in Compose, but Eclipse Ditto and the dashboard are not defined as services in the inspected Compose file. The deployment therefore depends on an external Ditto stack and a separately started dashboard.

The second limitation is that the main telemetry source is a simulator rather than a real elevator. The simulator is useful for development and testing because it produces consistent and controllable telemetry, but it cannot fully validate mechanical behavior, sensor noise, actuator response, safety relays, or real elevator controller integration.

The third limitation concerns security. The MQTT broker is now authenticated, ACL-enforced, and TLS-secured on the ESP32 hop, but the dashboard authentication is still local frontend state and the embedded sketch contains hardcoded network configuration. These remaining choices are acceptable for local development but must be replaced before production deployment (see [SECURITY.md](../SECURITY.md)).

The fourth limitation is that the n8n ingestion workflow currently uses scheduled polling of Ditto. This is simpler to operate locally, but a production event-driven architecture should use Ditto events, MQTT triggers, or webhook-based event dispatch to reduce latency and unnecessary polling.

The fifth limitation is that advanced AI is deliberately constrained. The deterministic risk engine is appropriate for safety-critical analysis, and optional local LLM support is limited to explanations. Future work could evaluate more advanced predictive models, but such models should remain supervised by deterministic safety gates and audit controls.

Additional limitations include inconsistent MQTT topic conventions, absent repository-level Ditto policies, lack of automated browser end-to-end tests in the inspected files, and no direct physical validation with ESP hardware connected to real sensors.

## 15. Conclusion

This chapter described the software design and implementation of the Agentic AI Smart Elevator Management System. The project is organized around a Digital Twin architecture in which MQTT acts as the ingestion layer, Eclipse Ditto represents the authoritative elevator state, the Next.js dashboard provides SCADA-style supervision, and n8n workflows implement agentic automation and decision support.

The implementation demonstrates a modular system with clear responsibilities. The simulator models elevator telemetry and anomalies, Mosquitto transports JSON messages, the bridge normalizes telemetry into Ditto, the dashboard visualizes and commands the twin, n8n workflows analyze and route events, and PostgreSQL/TimescaleDB provides persistence for historical and operational records. The software therefore supports the main thesis objectives of real-time monitoring, Digital Twin synchronization, automation, predictive maintenance support, and local deployment.

At the same time, the chapter identified realistic limitations. The system remains primarily local and simulator-driven, the security model is not production-grade, Ditto policy files are not present in the repository, and some configuration conventions need standardization. These limitations define clear future work while preserving the academic value of the current implementation as a structured, extensible, and technically coherent Digital Twin platform for smart elevator management.

