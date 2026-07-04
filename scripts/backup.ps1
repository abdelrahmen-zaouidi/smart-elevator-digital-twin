<#
.SYNOPSIS
  Back up every stateful store of the Smart Elevator Digital Twin platform
  into a single timestamped folder under backups\.

.DESCRIPTION
  Produces backups\<yyyy-MM-dd_HHmmss>\ containing:
    - postgres_smart_building.sql   pg_dump of the TimescaleDB database
    - n8n_workflows.json            n8n workflow export (all)
    - n8n_credentials.json          n8n credential export (encrypted form)
    - n8n_data.tgz                  fallback tar of the n8n data volume
                                    (only when the CLI export fails)
    - ditto_mongodb.archive         mongodump archive of the Ditto stack DB
    - mqtt_config.zip               infra\mqtt runtime secrets (passwordfile,
                                    certs, conf, aclfile) - SENSITIVE
    - manifest.txt                  what was captured, sizes, tool versions

  All dumps run INSIDE the containers and are copied out with docker cp, so
  no client tools are needed on the host and PowerShell never re-encodes the
  dump streams. backups\ is gitignored: it contains credentials and TLS keys.
  Copy each backup to an OFF-HOST location - a backup on the same disk only
  protects against mistakes, not disk loss.

.PARAMETER SkipMongo
  Skip the Eclipse Ditto MongoDB dump (e.g. when the Ditto stack is down).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\backup.ps1
#>
[CmdletBinding()]
param(
  [switch]$SkipMongo,
  [switch]$Help
)

if ($Help) { Get-Help $MyInvocation.MyCommand.Path -Detailed; exit 0 }

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $repoRoot

$stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$outDir = Join-Path $repoRoot "backups\$stamp"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$manifest = @("Smart Elevator Twin backup - $stamp", "host: $env:COMPUTERNAME", "")

function Add-Manifest([string]$line) { $script:manifest += $line; Write-Host $line }

# --- 1. PostgreSQL / TimescaleDB ---------------------------------------------
Add-Manifest "[1/4] PostgreSQL (container elevator_db)"
$pgUser = "admin"; $pgDb = "smart_building"
docker exec elevator_db pg_dump -U $pgUser -d $pgDb -f /tmp/backup.sql
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (exit $LASTEXITCODE)" }
docker cp elevator_db:/tmp/backup.sql "$outDir\postgres_smart_building.sql" | Out-Null
docker exec elevator_db rm -f /tmp/backup.sql
Add-Manifest ("  postgres_smart_building.sql  {0:N0} bytes" -f (Get-Item "$outDir\postgres_smart_building.sql").Length)

# --- 2. n8n -------------------------------------------------------------------
Add-Manifest "[2/4] n8n (container elevator_agents)"
$n8nOk = $true
docker exec elevator_agents n8n export:workflow --all --output=/tmp/n8n_workflows.json
if ($LASTEXITCODE -ne 0) { $n8nOk = $false }
if ($n8nOk) {
  docker exec elevator_agents n8n export:credentials --all --output=/tmp/n8n_credentials.json
  if ($LASTEXITCODE -ne 0) { $n8nOk = $false }
}
if ($n8nOk) {
  docker cp elevator_agents:/tmp/n8n_workflows.json  "$outDir\n8n_workflows.json"  | Out-Null
  docker cp elevator_agents:/tmp/n8n_credentials.json "$outDir\n8n_credentials.json" | Out-Null
  docker exec elevator_agents rm -f /tmp/n8n_workflows.json /tmp/n8n_credentials.json
  Add-Manifest "  n8n_workflows.json + n8n_credentials.json (credentials stay encrypted; the n8n encryption key lives in the n8n_data volume)"
} else {
  Add-Manifest "  n8n CLI export failed - falling back to a raw volume tar"
  docker run --rm --volumes-from elevator_agents -v "${outDir}:/backup" alpine tar czf /backup/n8n_data.tgz -C / home/node/.n8n
  if ($LASTEXITCODE -ne 0) { throw "n8n volume tar fallback failed" }
  Add-Manifest ("  n8n_data.tgz  {0:N0} bytes" -f (Get-Item "$outDir\n8n_data.tgz").Length)
}

# --- 3. Eclipse Ditto MongoDB --------------------------------------------------
if ($SkipMongo) {
  Add-Manifest "[3/4] Ditto MongoDB: SKIPPED (-SkipMongo)"
} else {
  Add-Manifest "[3/4] Eclipse Ditto MongoDB"
  $mongoName = docker ps --format "{{.Names}}" | Select-String -Pattern "mongo" | Select-Object -First 1 -ExpandProperty Line
  if (-not $mongoName) {
    Add-Manifest "  WARNING: no running mongo container found (Ditto stack down?) - skipped"
  } else {
    Add-Manifest "  container: $mongoName"
    docker exec $mongoName mongodump --archive=/tmp/ditto.archive --quiet
    if ($LASTEXITCODE -ne 0) { throw "mongodump failed (exit $LASTEXITCODE)" }
    docker cp "${mongoName}:/tmp/ditto.archive" "$outDir\ditto_mongodb.archive" | Out-Null
    docker exec $mongoName rm -f /tmp/ditto.archive
    Add-Manifest ("  ditto_mongodb.archive  {0:N0} bytes" -f (Get-Item "$outDir\ditto_mongodb.archive").Length)
  }
}

# --- 4. MQTT broker secrets/config --------------------------------------------
Add-Manifest "[4/4] MQTT config + secrets (infra\mqtt)"
Compress-Archive -Path "infra\mqtt\*" -DestinationPath "$outDir\mqtt_config.zip" -Force
Add-Manifest ("  mqtt_config.zip  {0:N0} bytes  (CONTAINS passwordfile + TLS private key)" -f (Get-Item "$outDir\mqtt_config.zip").Length)

$manifest += ""
$manifest += "Restore procedure: docs\operations.md (scripts\restore.ps1)"
$manifest | Out-File -FilePath "$outDir\manifest.txt" -Encoding utf8

Write-Host ""
Write-Host "Backup complete: $outDir"
Write-Host "REMINDER: copy this folder off-host; it contains credentials and keys."
