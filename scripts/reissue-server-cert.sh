#!/usr/bin/env bash
# =============================================================================
# reissue-server-cert.sh  --  Re-issue ONLY the Mosquitto server leaf cert
# -----------------------------------------------------------------------------
# Use this when the broker IP changes (e.g. the elevator LAN was re-subnetted).
# It signs a NEW server.crt with the EXISTING ca.crt/ca.key, so:
#   * the CA pinned in the ESP32 firmware stays valid  -> NO reflash required
#   * only the server leaf (server.crt) is replaced, with an updated SAN
#
# The server cert SAN MUST contain every IP/host a TLS client uses to reach the
# broker -- most importantly the IP the ESP32 connects to (MQTT_SERVER in
# secrets.h). A missing IP makes the ESP32 TLS handshake fail with PubSubClient
# rc=-2 (openssl reports "hostname mismatch", verify code 62).
#
# Requirements: openssl, and existing infra/mqtt/certs/{ca.crt,ca.key}.
# Usage (defaults already include the current + previous lab IPs):
#   bash scripts/reissue-server-cert.sh
# Override:
#   BROKER_IP=192.168.10.10 \
#   BROKER_EXTRA_SAN="IP:192.168.100.7,IP:10.0.16.55,DNS:elevator.local" \
#     bash scripts/reissue-server-cert.sh
# After running: restart the broker so it loads the new cert:
#   docker compose restart mosquitto
# =============================================================================
set -euo pipefail

# Git Bash / MSYS mangles "/CN=..." style args; disable that conversion.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

# --- configurable ------------------------------------------------------------
BROKER_IP="${BROKER_IP:-192.168.10.10}"          # PRIMARY IP the ESP32 connects to
DAYS_SERVER="${DAYS_SERVER:-825}"                # leaf validity (<=825d per CA/B baseline)
# Keep previous lab IPs in the SAN so the broker still works if you move back to
# an old network without re-issuing. Override BROKER_EXTRA_SAN to change.
BROKER_EXTRA_SAN="${BROKER_EXTRA_SAN:-IP:192.168.100.7,IP:192.168.100.87,IP:10.0.16.55}"
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="$SCRIPT_DIR/../infra/mqtt/certs"
cd "$CERT_DIR"

if [ ! -f ca.crt ] || [ ! -f ca.key ]; then
  echo "[reissue] ERROR: ca.crt / ca.key not found in $CERT_DIR" >&2
  echo "          Run scripts/gen-mqtt-certs.sh first (that also creates the CA)." >&2
  exit 1
fi

SAN="IP:${BROKER_IP},IP:127.0.0.1,DNS:mosquitto,DNS:localhost"
if [ -n "$BROKER_EXTRA_SAN" ]; then SAN="${SAN},${BROKER_EXTRA_SAN}"; fi

echo "[reissue] cert dir   : $CERT_DIR"
echo "[reissue] primary IP : $BROKER_IP"
echo "[reissue] server SAN : $SAN"

# Back up the current leaf so a bad reissue is recoverable.
if [ -f server.crt ]; then
  BAK="server.crt.bak-$(date +%Y%m%d-%H%M%S)"
  cp server.crt "$BAK"
  echo "[reissue] backed up old server.crt -> $BAK"
fi

# Reuse the existing server.key if present (keeps perms the broker already has);
# otherwise generate a fresh ECDSA P-256 key (lighter TLS handshake on ESP32).
if [ ! -f server.key ]; then
  echo "[reissue] server.key missing -> generating a new ECDSA P-256 key"
  openssl ecparam -genkey -name prime256v1 -out server.key
  chown 1883:1883 server.key 2>/dev/null || true
  chmod 600 server.key 2>/dev/null || true
fi

# Fresh CSR + signed leaf with the new SAN, signed by the EXISTING CA.
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
chmod 644 server.crt 2>/dev/null || true

echo
echo "[reissue] new leaf signed by existing CA. SAN now:"
openssl x509 -in server.crt -noout -ext subjectAltName | sed 's/^/    /'
openssl x509 -in server.crt -noout -dates | sed 's/^/    /'
echo
echo "[reissue] CA is UNCHANGED -> ESP32 firmware does NOT need reflashing."
echo "[reissue] Now reload the broker:  docker compose restart mosquitto"
