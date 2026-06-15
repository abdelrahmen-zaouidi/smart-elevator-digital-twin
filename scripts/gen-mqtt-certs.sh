#!/usr/bin/env bash
# =============================================================================
# gen-mqtt-certs.sh  --  Local CA + Mosquitto server certificate (server-only TLS)
# -----------------------------------------------------------------------------
# Generates, under infra/mqtt/certs/:
#   ca.key  ca.crt          - your private Certificate Authority
#   server.key server.crt   - the broker's TLS server certificate, signed by the CA
#
# The ESP32 pins ca.crt (server-only TLS, NOT mutual TLS). The server cert SAN
# MUST contain every address a TLS client uses to reach the broker -- most
# importantly the IP the ESP32 connects to. Re-run this if that IP changes.
#
# Keys use ECDSA P-256 (prime256v1): lighter TLS handshake on the ESP32 than RSA.
#
# Requirements: openssl (Git Bash / WSL both ship it). Run from anywhere:
#   bash scripts/gen-mqtt-certs.sh
# Override the broker addresses:
#   BROKER_IP=192.168.1.50 BROKER_EXTRA_SAN="IP:10.0.0.5,DNS:elevator.local" \
#     bash scripts/gen-mqtt-certs.sh
# =============================================================================
set -euo pipefail

# Git Bash / MSYS mangles arguments that look like Unix paths (e.g. the "/CN=..."
# in openssl -subj). Disable that conversion; harmless under WSL/real bash.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

# --- configurable ------------------------------------------------------------
BROKER_IP="${BROKER_IP:-192.168.100.7}"        # IP the ESP32 connects to (must match)
DAYS_CA="${DAYS_CA:-1825}"                      # CA validity (~5y)
DAYS_SERVER="${DAYS_SERVER:-825}"               # leaf validity (<=825d per CA/B baseline)
BROKER_EXTRA_SAN="${BROKER_EXTRA_SAN:-}"        # optional extra SANs, comma-separated
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="$SCRIPT_DIR/../infra/mqtt/certs"
mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

SAN="IP:${BROKER_IP},IP:127.0.0.1,DNS:mosquitto,DNS:localhost"
if [ -n "$BROKER_EXTRA_SAN" ]; then SAN="${SAN},${BROKER_EXTRA_SAN}"; fi

echo "[certs] output dir : $CERT_DIR"
echo "[certs] server SAN : $SAN"

if [ -f ca.crt ] && [ "${FORCE:-0}" != "1" ]; then
  echo "[certs] ca.crt already exists. Re-run with FORCE=1 to overwrite (this invalidates"
  echo "        the CA already pinned in firmware). Refusing to overwrite silently."
  exit 1
fi

# --- CA ----------------------------------------------------------------------
openssl ecparam -genkey -name prime256v1 -out ca.key
openssl req -x509 -new -nodes -key ca.key -sha256 -days "$DAYS_CA" \
  -subj "/CN=SmartElevator Local CA/O=SmartElevatorTwin" -out ca.crt

# --- server leaf -------------------------------------------------------------
openssl ecparam -genkey -name prime256v1 -out server.key
openssl req -new -key server.key \
  -subj "/CN=smart-elevator-mqtt/O=SmartElevatorTwin" -out server.csr

cat > server.ext <<EOF
subjectAltName=${SAN}
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
EOF

openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days "$DAYS_SERVER" -sha256 -extfile server.ext -out server.crt

rm -f server.csr server.ext ca.srl

# Mosquitto runs as the 'mosquitto' user (uid 1883) inside the container and must
# be able to read server.key after dropping privileges. The CA key is only needed
# for future rotation and must not be readable by the broker or other users.
chown 1883:1883 server.key 2>/dev/null || true
chown 0:0 ca.key 2>/dev/null || true
chmod 600 server.key ca.key 2>/dev/null || true
chmod 644 server.crt ca.crt 2>/dev/null || true

echo
echo "[certs] done:"
ls -l "$CERT_DIR"
echo
echo "[certs] Embed ca.crt into the firmware (secrets.h MQTT_CA_CERT) and point the"
echo "        ESP32 at ${BROKER_IP}:8883. Keep *.key PRIVATE (already gitignored)."
