#!/usr/bin/env bash
# scripts/demo/bootstrap-demo.sh
#
# One-time bootstrap for a FRESH CLONE so `docker compose --profile demo up -d`
# can work: the broker refuses to start without a passwordfile and TLS certs,
# and every identity needs a real password. Idempotent - existing .env values,
# passwordfile entries, and certs are never overwritten.
#
# Usage (Git Bash / WSL / Linux, Docker running):
#   bash scripts/demo/bootstrap-demo.sh
#
# What it does:
#   1. Creates .env from .env.example if missing.
#   2. Replaces every CHANGE_ME MQTT password in .env with a random value.
#   3. Creates infra/mqtt/passwordfile (via the mosquitto image) for the five
#      broker identities, using the passwords from .env.
#   4. Generates the local CA + broker TLS cert via scripts/gen-mqtt-certs.sh
#      if infra/mqtt/certs/ is missing (the 8883 listener needs them even if
#      the demo itself only uses 1883).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

rand() { openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-32; }

# --- 1. .env ----------------------------------------------------------------
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "created .env from .env.example"
else
  echo ".env already exists - keeping it"
fi

# Ensure the device identity keys exist (older .env files predate them).
grep -q '^MQTT_ESP32_USERNAME=' .env || printf '\nMQTT_ESP32_USERNAME=esp32-elevator\nMQTT_ESP32_PASSWORD=CHANGE_ME\n' >> .env

# --- 2. randomize CHANGE_ME MQTT passwords ----------------------------------
for key in MQTT_HEALTHCHECK_PASSWORD MQTT_BRIDGE_PASSWORD MQTT_AGENTS_PASSWORD MQTT_ESP32_PASSWORD; do
  if grep -q "^${key}=CHANGE_ME$" .env; then
    value="$(rand)"
    # sed -i works on GNU sed (Git Bash/WSL/Linux)
    sed -i "s|^${key}=CHANGE_ME$|${key}=${value}|" .env
    echo "generated ${key}"
  fi
done

# --- 3. passwordfile ---------------------------------------------------------
get_env() { grep "^$1=" .env | head -1 | cut -d= -f2-; }

if [[ -f infra/mqtt/passwordfile ]]; then
  echo "infra/mqtt/passwordfile already exists - keeping it"
else
  echo "creating infra/mqtt/passwordfile (five broker identities)..."
  touch infra/mqtt/passwordfile
  add_user() { # user password
    docker run --rm -v "$(pwd)/infra/mqtt:/work" eclipse-mosquitto:2 \
      mosquitto_passwd -b /work/passwordfile "$1" "$2"
  }
  add_user healthcheck     "$(get_env MQTT_HEALTHCHECK_PASSWORD)"
  add_user bridge          "$(get_env MQTT_BRIDGE_PASSWORD)"
  add_user agents          "$(get_env MQTT_AGENTS_PASSWORD)"
  add_user esp32-elevator  "$(get_env MQTT_ESP32_PASSWORD)"
  # read-only browser identity; password is public-ish by design (read-only ACL)
  add_user dashboard       "$(get_env MQTT_ESP32_PASSWORD | rev)"
  echo "passwordfile created"
fi

# --- 4. TLS certs ------------------------------------------------------------
if [[ -d infra/mqtt/certs && -f infra/mqtt/certs/server.crt ]]; then
  echo "infra/mqtt/certs already exists - keeping it"
else
  echo "generating MQTT TLS material via scripts/gen-mqtt-certs.sh ..."
  bash scripts/gen-mqtt-certs.sh
fi

echo ""
echo "Bootstrap complete. Next:"
echo "  1. start the Eclipse Ditto stack (its own docker compose)"
echo "  2. docker compose --profile demo up -d"
echo "  3. cd apps/dashboard && npm run dev   ->  http://localhost:3000"
