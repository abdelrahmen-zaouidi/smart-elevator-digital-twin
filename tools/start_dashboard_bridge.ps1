$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$dashboardRoot = Join-Path $repoRoot "dashboard"

$env:MQTT_BROKER_URL = "mqtt://127.0.0.1:1883"
# Canonical MQTT topic convention: elevator/{mqtt_safe_thing_id}/{telemetry|events|commands|status}
# The bridge subscribes fleet-wide via single-level wildcards.
$env:MQTT_TELEMETRY_SUBSCRIPTION = "elevator/+/telemetry"
$env:MQTT_EVENTS_SUBSCRIPTION    = "elevator/+/events"
$env:MQTT_STATUS_SUBSCRIPTION    = "elevator/+/status"
$env:MQTT_COMMANDS_SUBSCRIPTION  = "elevator/+/commands"
# Legacy single-topic var still honoured if set. Leave empty so the bridge's
# canonical subscription set is used as-is.
$env:MQTT_TOPIC = ""
$env:DITTO_URL = "http://127.0.0.1:8080"
$env:DITTO_USER = "ditto"
$env:DITTO_PASSWORD = "ditto"
$env:PRIMARY_THING_ID = "building:floor1:elevator"
$env:PRIMARY_MQTT_ID  = "building-floor1-elevator"

Set-Location $dashboardRoot
npm run bridge
