# Observability Profile — Evidence (2026-07-05)

WI-4 (Phase 2): Prometheus metrics from the bridge + dashboard, scraped by a
Prometheus/Grafana stack under the `observability` compose profile. Verified
live on the reference host.

## Bring-up

```bash
docker compose --profile observability up -d   # + simulator for traffic
```

Containers: `elevator_prometheus` (prom/prometheus:v2.54.1, 7-day retention),
`elevator_grafana` (grafana-oss:11.2.2, provisioned).

## Prometheus targets — both UP

```
job=bridge     up   http://bridge:9464/metrics
job=dashboard  up   http://host.docker.internal:3000/api/system/metrics
```

The bridge exposes `/metrics` (+ `/health`) on 9464, scraped in-network. The
dashboard runs on the host; Prometheus reaches it via `host.docker.internal`.
`/api/system/metrics` is exempt from the demo Basic-Auth middleware (read-only
counters), so the scrape needs no credentials.

## Live metrics through Prometheus

| Query | Result |
|---|---|
| `bridge_ingest_messages_total` | `{type=telemetry}` 71, `{type=events}` 1 (growing) |
| `dashboard_gate_decisions_total` | `{verdict=accepted, command=OPEN_DOOR}` 1 |
| `dashboard_health_probe_status` | ditto=1, bridge=1, mqtt=1, postgres=1, n8n=1 |

Other bridge series exposed: `bridge_ditto_merge_duration_seconds` (histogram —
the single-thing write bottleneck), `bridge_ditto_merge_total{result}`,
`bridge_command_lifecycle_total{event}`, `bridge_mqtt_reconnects_total`, plus
default process/node metrics.

## Grafana — provisioned end to end

- Datasource `Prometheus` (http://prometheus:9090) auto-provisioned.
- Dashboard **ElevatorOS — Platform Overview** (uid `elevatoros-overview`)
  auto-provisioned (ingest rate, Ditto merge-latency quantiles,
  command-lifecycle, gate verdicts, dependency-health panels).
- Query through Grafana's datasource proxy returned live data
  (`bridge_ingest_messages_total` → telemetry=71, events=1, status success).

## RAM footprint (≤500 MB budget)

```
elevator_prometheus   27.7 MiB / 300 MiB
elevator_grafana      76.2 MiB / 512 MiB
```

Total added ≈ **104 MiB** — well within budget on the ~7.8 GB host.

## Teardown

```bash
docker compose --profile observability down   # frees the ~104 MiB
```

Default `docker compose up -d` is unchanged (both new services are behind the
`observability` profile, OFF by default).
