# scripts/init-ditto.ps1
# Provision the elevator Digital Twin in Eclipse Ditto.
# All operations are idempotent (PUT = upsert). Safe to re-run.
#
# Usage:
#   .\scripts\init-ditto.ps1
#
# To use admin credentials on HTTP 403:
#   $env:DITTO_USERNAME="devops"; $env:DITTO_PASSWORD="foobar"; .\scripts\init-ditto.ps1

$ErrorActionPreference = "Stop"

# ---- Load .env ----
$envFile = Join-Path (Join-Path $PSScriptRoot "..") ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { return }
        $sep = $line.IndexOf("=")
        if ($sep -le 0) { return }
        $key   = $line.Substring(0, $sep).Trim()
        $value = $line.Substring($sep + 1).Trim().Trim('"').Trim("'")
        if (-not [System.Environment]::GetEnvironmentVariable($key)) {
            [System.Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
}

$DITTO_URL  = if ($env:DITTO_PUBLIC_BASE_URL) { $env:DITTO_PUBLIC_BASE_URL } else { "http://localhost:8080" }
$DITTO_USER = if ($env:DITTO_USERNAME)         { $env:DITTO_USERNAME }         else { "ditto" }
$DITTO_PASS = if ($env:DITTO_PASSWORD)         { $env:DITTO_PASSWORD }         else { "ditto" }
$THING_ID   = if ($env:PRIMARY_THING_ID)       { $env:PRIMARY_THING_ID }       else { "building:floor1:elevator" }

$authBytes  = [System.Text.Encoding]::UTF8.GetBytes($DITTO_USER + ":" + $DITTO_PASS)
$authHeader = "Basic " + [Convert]::ToBase64String($authBytes)
$headers    = @{ Authorization = $authHeader; "Content-Type" = "application/json" }

Write-Host "=============================================="
Write-Host "  Eclipse Ditto - Digital Twin Provisioning"
Write-Host "=============================================="
Write-Host "  URL      : $DITTO_URL"
Write-Host "  User     : $DITTO_USER"
Write-Host "  Thing ID : $THING_ID"
Write-Host ""

# ---- 1. Wait for Ditto ----
Write-Host "[1/3] Waiting for Eclipse Ditto to be ready..."
$maxRetries = 30
$retry = 0
$ready = $false
while (-not $ready -and $retry -lt $maxRetries) {
    try {
        $null = Invoke-WebRequest -Uri "$DITTO_URL/health" -UseBasicParsing -TimeoutSec 3
        $ready = $true
    } catch {
        try {
            $null = Invoke-WebRequest -Uri "$DITTO_URL/actuator/health" -UseBasicParsing -TimeoutSec 3
            $ready = $true
        } catch {
            $retry++
            Write-Host ("  waiting... ({0}/{1})`r" -f $retry, $maxRetries) -NoNewline
            Start-Sleep -Seconds 3
        }
    }
}
if (-not $ready) {
    Write-Error "Ditto not reachable at $DITTO_URL after $($maxRetries * 3)s. Is Eclipse Ditto running?"
    exit 1
}
Write-Host "  Ditto is up.                    "

# ---- 2. Create / update Policy ----
Write-Host "[2/3] Creating policy $THING_ID ..."

$policyBody = @'
{
  "entries": {
    "owner": {
      "subjects": {
        "nginx:__USER__": { "type": "generated" }
      },
      "resources": {
        "thing:/":   { "grant": ["READ","WRITE"], "revoke": [] },
        "policy:/":  { "grant": ["READ","WRITE"], "revoke": [] },
        "message:/": { "grant": ["READ","WRITE"], "revoke": [] }
      }
    }
  }
}
'@
$policyBody = $policyBody.Replace("__USER__", $DITTO_USER)

try {
    $r = Invoke-WebRequest -Uri "$DITTO_URL/api/2/policies/$THING_ID" `
         -Method PUT -Headers $headers -Body $policyBody -UseBasicParsing
    Write-Host "  Policy created/updated (HTTP $($r.StatusCode))."
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 403) {
        Write-Warning "HTTP 403. Re-run with: `$env:DITTO_USERNAME='devops'; `$env:DITTO_PASSWORD='foobar'"
    } else {
        Write-Warning "Policy PUT returned HTTP $code. Continuing..."
    }
}

# ---- 3. Create / update Thing with all 12 features ----
# Property names match the simulator (esp32_simulator.py build_ditto_payload) exactly.
# energy/performance/predicted_failures/ai_analysis/maintenance_schedule are written
# by n8n workflows; they are seeded here with zero defaults so the dashboard never
# sees undefined for those fields.
Write-Host "[3/3] Provisioning Thing $THING_ID (12 features)..."

$thingBody = @'
{
  "policyId": "__THING_ID__",
  "attributes": {
    "location": "floor1",
    "manufacturer": "ElevatorCo",
    "model": "SmartLift-2000",
    "serialNumber": "SL-2000-001"
  },
  "features": {
    "cabin": {
      "properties": {
        "current_floor": 0,
        "target_floor": 0,
        "direction": "idle",
        "load_kg": 0.0,
        "temperature_c": 20.0,
        "speed_ms": 0.0,
        "emergency_stop": false
      }
    },
    "door": {
      "properties": {
        "state": "CLOSED",
        "door_forced_entry": false
      }
    },
    "motor": {
      "properties": {
        "vibration_level": 0.0,
        "hours_operated": 0.0,
        "health_status": "GOOD",
        "temperature_c": 35.0
      }
    },
    "security": {
      "properties": {
        "audio_distress_active": false,
        "unauthorized_access_attempts": 0,
        "rfid_last_card": "",
        "rfid_access_granted": true,
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
        "entries": [],
        "open_incidents": 0
      }
    },
    "control": {
      "properties": {}
    },
    "energy": {
      "properties": {
        "kwh_today": 0.0,
        "kwh_month": 0.0,
        "kwh_baseline": 0.0,
        "co2_kg": 0.0,
        "regen_kwh": 0.0
      }
    },
    "performance": {
      "properties": {
        "avg_wait_s": 0.0,
        "avg_trip_s": 0.0,
        "availability_pct": 100.0,
        "door_cycle_efficiency": 100.0
      }
    },
    "predicted_failures": {
      "properties": {
        "bearing_days": null,
        "door_motor_days": null,
        "brake_days": null,
        "overall_risk": 0
      }
    },
    "ai_analysis": {
      "properties": {
        "last_analysis_at": null,
        "risk_score": 0,
        "risk_label": "LOW",
        "summary": "",
        "recommended_actions": []
      }
    },
    "maintenance_schedule": {
      "properties": {
        "next_service_date": null,
        "last_service_date": null,
        "open_work_orders": 0,
        "priority": "NORMAL"
      }
    }
  }
}
'@
$thingBody = $thingBody.Replace("__THING_ID__", $THING_ID)

try {
    $r = Invoke-WebRequest -Uri "$DITTO_URL/api/2/things/$THING_ID" `
         -Method PUT -Headers $headers -Body $thingBody -UseBasicParsing
    Write-Host "  Thing provisioned (HTTP $($r.StatusCode))."
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Write-Error "Thing PUT returned HTTP $code. Check Ditto credentials and policy."
    exit 1
}

Write-Host ""
Write-Host "Done. Verify with:"
Write-Host "  Invoke-RestMethod -Uri '$DITTO_URL/api/2/things/$THING_ID' -Headers @{Authorization='$authHeader'} | ConvertTo-Json -Depth 10"
