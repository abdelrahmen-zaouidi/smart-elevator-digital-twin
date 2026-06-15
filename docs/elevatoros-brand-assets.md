# ElevatorOS Brand Asset Pack

## Purpose

The dashboard branding replaces default generator-style marks with an industrial SCADA identity for the Smart & Secure Elevator Digital Twin Platform.

The current direction is based on the selected Canva candidate:

- Canva design ID: `DAHLXxRBY7w`
- Canva title: `Industrial ElevatorOS Logo with Data Levels`
- Editable Canva URL: `https://www.canva.com/d/IxufVCRevK2QbvK`

## Asset Map

| Asset | Purpose |
| --- | --- |
| `apps/dashboard/public/icon.svg` | Browser SVG favicon and compact app mark |
| `apps/dashboard/public/icon-light-32x32.png` | Favicon optimized for light browser chrome |
| `apps/dashboard/public/icon-dark-32x32.png` | Favicon optimized for dark browser chrome |
| `apps/dashboard/public/apple-icon.png` | 180x180 Apple touch icon |
| `apps/dashboard/public/placeholder-logo.svg` | Horizontal ElevatorOS logo replacement |
| `apps/dashboard/public/placeholder-logo.png` | PNG horizontal logo replacement |
| `apps/dashboard/public/elevatoros-mark.svg` | In-app sidebar/login compact mark |
| `apps/dashboard/public/elevatoros-logo.svg` | Source horizontal SVG logo |

## SVG-Safe Colors

| Token | Hex | Usage |
| --- | --- | --- |
| SCADA background | `#07141A` | Icon tile and horizontal logo background |
| Data cyan | `#12C6D8` | Primary telemetry data bar |
| Signal cyan | `#18D5E5` | Product `OS` wordmark and active data bar |
| Highlight cyan | `#5FEAF2` | Brightest data level accent |
| Elevator steel | `#64727A` | Elevator frame and subtitle |
| Wordmark steel | `#7D8A90` | Product `Elevator` wordmark |
| Rail shadow | `#172833` | Grounding line under the mark |
| Alert red | `#EF4D43` | Operational status node |

## Replacement Notes

The in-app brand mark previously used the Lucide `Zap` icon. It now renders `/elevatoros-mark.svg` inside the existing `.eos-brand-mark` shell, preserving layout size while replacing the generic default symbol with a product-specific elevator telemetry mark.

The current Canva-selected direction is a quieter industrial wordmark: an elevator-frame symbol with three cyan data-level bars and a red operational status node. It avoids the previous shield-heavy mark and reads better as a SCADA product identity.
The icon combines:

- an elevator shaft and cabin,
- live data levels for telemetry and digital-twin state,
- steel-gray industrial framing,
- a small red operational alert node.
