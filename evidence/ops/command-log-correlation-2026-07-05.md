# Structured-Log Command Correlation — Evidence (2026-07-05)

WI-3 (Phase 2): both the dashboard API routes and the bridge now emit
structured JSON logs (pino) with a shared field convention, so one
`grep '"command_id":"..."'` across the two services reconstructs a command's
whole lifecycle.

## Field convention

```
{ ts, level, svc, event?, thing_id?, command_id?, correlation_id?, msg, ... }
```

`svc` = `dashboard` (API routes, `apps/dashboard/src/server/log.js`) or
`bridge` (`services/ditto-bridge/logger.js`).

## Live trace — one accepted command end to end

Command: `RELEASE_LOCKDOWN` issued through `POST /api/commands`
(operator `demo`, accepted by the safety gate, written to Ditto, fanned out by
the bridge, acknowledged by the simulated device).

`command_id = CMD-MR81STQU-0003-FDOXKT`

| ts | svc | event | msg |
|---|---|---|---|
| 17:11:27.127Z | dashboard | `command_accepted` | safety gate decision |
| 17:11:27.802Z | bridge | `command_intent_forwarded` | Ditto command intent forwarded |
| 17:11:27.806Z | bridge | `command_mqtt_published` | command published to device |
| 17:11:27.989Z | bridge | `command_ack_received` | device command result persisted |

End-to-end (gate accept → device ack) ≈ **862 ms**.

Raw dashboard line (gate verdict, attributed to the operator identity):

```json
{"level":"info","ts":"2026-07-05T17:11:27.127Z","svc":"dashboard",
 "event":"command_accepted","command_id":"CMD-MR81STQU-0003-FDOXKT",
 "correlation_id":"CID-...","thing_id":"building:floor1:elevator",
 "command":"RELEASE_LOCKDOWN","accepted":true,"risk_score":...,
 "requested_by":"demo","role":"OPERATOR","msg":"safety gate decision"}
```

A rejected command is equally visible (same `event:"command_rejected"` shape
with a `reason` array) and — per the safety invariant — produces NO bridge
lifecycle lines, because a rejected command performs no Ditto write.

## Also verified

- The bridge still merges telemetry into Ditto after the pino migration
  (`"[Bridge] Ditto twin merged for building:floor1:elevator"` present in the
  rebuilt image's logs).
- Bridge image rebuilt from a real `package.json` + lockfile via `npm ci`
  (replacing the previous `printf` one-liner), now including `pino`.
