# Figure Plan

This draft keeps the centerpiece command-path figure directly in `main.tex` so the article compiles without external assets. For camera-ready submission, prepare the following figures from the thesis/repository.

| Figure | Source | Status | Caption |
|---|---|---|---|
| Safety-gated command path | Regenerate from `main.tex` Figure 1 as vector artwork or keep the native LaTeX version. | Included as LaTeX. | Safety-gated command path from operator or agent request to Ditto intent, audit persistence, bridge forwarding, MQTT command topic, and firmware-side interlocks. |
| Global system architecture | Thesis Chapter 3 `fig:global-synoptic-architecture-image`; repository `docs/features/global-synoptic-architecture-*.svg`. | To regenerate/export as PDF or PNG. | Layered telemetry, digital twin, agentic workflow, database, SCADA, and command-feedback architecture. |
| Prototype overview | Thesis Chapter 2 `fig:prototype-overview`; thesis source `figures/prototype/annotated/prototype_full_front_view_annotated.jpg`. | To include if journal page budget allows. | Reduced-scale four-floor ESP32-S3 smart elevator prototype with shaft, local interface, RFID reader, LCD, buttons, and simulated telemetry inputs. |
| Ditto Thing model | Thesis Chapter 3 Ditto model figure or regenerate from `docs/ditto-twin-reference.md`. | To regenerate. | Eclipse Ditto Thing decomposition into attributes and subsystem features. |
| Dashboard command center | Thesis validation/dashboard screenshot package: `evidence/dashboard/command_center_page.png`. | To include if journal page budget allows. | SCADA command center showing safety-gated command submission and recent command decisions. |
| n8n workflow layer | Thesis Chapter 3 workflow figures or exports in `workflows/n8n/*.json`. | To regenerate from n8n editor. | Multi-workflow agentic layer: surveillance, analysis, control, security/maintenance, notification, optimization, and audit. |
| Validation evidence montage | Regenerate from `evidence/` logs, Ditto export, database rows, and MQTT ACL capture. | Optional. | Representative validation artifacts for MQTT security, Ditto synchronization, command safety gate, and database persistence. |

Before submission, use vector formats where possible (`.pdf`, `.svg`) and avoid screenshots for diagrams unless the journal accepts them.
