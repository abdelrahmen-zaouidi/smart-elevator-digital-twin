#!/usr/bin/env bash
# scripts/init-ditto.sh
# Provision the elevator Digital Twin in Eclipse Ditto.
# Run once after Ditto is up. All operations are idempotent (PUT = upsert).
#
# Usage (Linux / WSL / Git Bash):
#   bash scripts/init-ditto.sh
#
# NOTE: Eclipse Ditto's default Docker setup ships with two users:
#   ditto / ditto      — regular user
#   devops / foobar    — admin user
# If policy creation returns HTTP 403, re-run with:
#   DITTO_USERNAME=devops DITTO_PASSWORD=foobar bash scripts/init-ditto.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"

if [[ -f "$ENV_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    value="${value%\"}"
    value="${value#\"}"
    [[ -z "${!key+x}" ]] && export "$key"="$value"
  done < "$ENV_FILE"
fi

DITTO_URL="${DITTO_PUBLIC_BASE_URL:-http://localhost:8080}"
DITTO_USER="${DITTO_USERNAME:-ditto}"
DITTO_PASS="${DITTO_PASSWORD:-ditto}"
THING_ID="${PRIMARY_THING_ID:-building:floor1:elevator}"

echo "=============================================="
echo "  Eclipse Ditto - Digital Twin Provisioning"
echo "=============================================="
echo "  URL      : ${DITTO_URL}"
echo "  User     : ${DITTO_USER}"
echo "  Thing ID : ${THING_ID}"
echo ""

# ---------------------------------------------------------------------------
# 1. Wait for Ditto
# ---------------------------------------------------------------------------
echo "[1/3] Waiting for Eclipse Ditto to be ready..."
MAX_RETRIES=30
RETRY=0
until curl -sf -o /dev/null "${DITTO_URL}/health" 2>/dev/null \
   || curl -sf -o /dev/null "${DITTO_URL}/actuator/health" 2>/dev/null; do
  RETRY=$((RETRY + 1))
  if [[ $RETRY -ge $MAX_RETRIES ]]; then
    echo "ERROR: Ditto not reachable at ${DITTO_URL} after $((MAX_RETRIES * 3))s."
    exit 1
  fi
  printf "  waiting... (%d/%d)\r" "$RETRY" "$MAX_RETRIES"
  sleep 3
done
echo "  Ditto is up.                              "

# ---------------------------------------------------------------------------
# 2. Create / update Policy
# ---------------------------------------------------------------------------
echo "[2/3] Creating policy ${THING_ID}..."

HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X PUT \
  -u "${DITTO_USER}:${DITTO_PASS}" \
  -H "Content-Type: application/json" \
  "${DITTO_URL}/api/2/policies/${THING_ID}" \
  -d "{
  \"entries\": {
    \"owner\": {
      \"subjects\": {
        \"nginx:${DITTO_USER}\": { \"type\": \"generated\" }
      },
      \"resources\": {
        \"thing:/\":   { \"grant\": [\"READ\",\"WRITE\"], \"revoke\": [] },
        \"policy:/\":  { \"grant\": [\"READ\",\"WRITE\"], \"revoke\": [] },
        \"message:/\": { \"grant\": [\"READ\",\"WRITE\"], \"revoke\": [] }
      }
    }
  }
}")

case "$HTTP_STATUS" in
  201) echo "  Policy created (HTTP 201)." ;;
  204) echo "  Policy updated (HTTP 204)." ;;
  403) echo "  WARNING: HTTP 403. Re-run with: DITTO_USERNAME=devops DITTO_PASSWORD=foobar bash scripts/init-ditto.sh" ;;
  *)   echo "  WARNING: HTTP ${HTTP_STATUS}. Continuing..." ;;
esac

# ---------------------------------------------------------------------------
# 3. Create / update Thing with all 12 features
# Property names match the simulator (esp32_simulator.py) exactly.
# energy/performance/predicted_failures/ai_analysis/maintenance_schedule are
# seeded with zero defaults so the dashboard never sees undefined fields.
# ---------------------------------------------------------------------------
echo "[3/3] Provisioning Thing ${THING_ID} (12 features)..."

HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X PUT \
  -u "${DITTO_USER}:${DITTO_PASS}" \
  -H "Content-Type: application/json" \
  "${DITTO_URL}/api/2/things/${THING_ID}" \
  -d @- <<EOF
{
  "policyId": "${THING_ID}",
  "attributes": {
    "location": "floor1",
    "manufacturer": "ElevatorCo",
    "model": "SmartLift-2000",
    "serialNumber": "SL-2000-001"
  },
  "features": {
    "cabin": {
      "properties": {
        "current_floor": 0, "target_floor": 0, "direction": "idle",
        "load_kg": 0.0, "temperature_c": 20.0,
        "speed_ms": 0.0, "emergency_stop": false
      }
    },
    "door": {
      "properties": {
        "state": "CLOSED", "door_forced_entry": false
      }
    },
    "motor": {
      "properties": {
        "vibration_level": 0.0, "hours_operated": 0.0,
        "health_status": "GOOD", "temperature_c": 35.0
      }
    },
    "security": {
      "properties": {
        "audio_distress_active": false,
        "unauthorized_access_attempts": 0,
        "rfid_last_card": "", "rfid_access_granted": true,
        "alert_level": "NORMAL"
      }
    },
    "microcontroller": {
      "properties": {
        "board": "ESP32-S3",
        "connected": false,
        "status": "OFFLINE",
        "source": "mqtt_status",
        "transport": "MQTT",
        "mqtt_id": "building-floor1-elevator",
        "mqtt_topic": "elevator/building-floor1-elevator/status",
        "telemetry_topic": "elevator/building-floor1-elevator/telemetry",
        "last_seen_at": null,
        "last_telemetry_at": null,
        "last_status_at": null,
        "last_disconnected_at": null
      }
    },
    "incident_log": {
      "properties": {
        "entries": [], "open_incidents": 0
      }
    },
    "control": {
      "properties": {}
    },
    "energy": {
      "properties": {
        "kwh_today": 0.0, "kwh_month": 0.0,
        "kwh_baseline": 0.0, "co2_kg": 0.0, "regen_kwh": 0.0
      }
    },
    "performance": {
      "properties": {
        "avg_wait_s": 0.0, "avg_trip_s": 0.0,
        "availability_pct": 100.0, "door_cycle_efficiency": 100.0
      }
    },
    "predicted_failures": {
      "properties": {
        "bearing_days": null, "door_motor_days": null,
        "brake_days": null, "overall_risk": 0
      }
    },
    "ai_analysis": {
      "properties": {
        "last_analysis_at": null, "risk_score": 0,
        "risk_label": "LOW", "summary": "",
        "recommended_actions": []
      }
    },
    "maintenance_schedule": {
      "properties": {
        "next_service_date": null, "last_service_date": null,
        "open_work_orders": 0, "priority": "NORMAL"
      }
    }
  }
}
EOF
)

case "$HTTP_STATUS" in
  201) echo "  Thing created (HTTP 201)." ;;
  204) echo "  Thing updated (HTTP 204)." ;;
  403) echo "  ERROR: HTTP 403. Policy may not have been created." ; exit 1 ;;
  *)   echo "  WARNING: HTTP ${HTTP_STATUS}." ;;
esac

echo ""
echo "Done. Verify with:"
echo "  curl -u ${DITTO_USER}:${DITTO_PASS} ${DITTO_URL}/api/2/things/${THING_ID} | python3 -m json.tool"
