<#
.SYNOPSIS
  Restore one store of the Smart Elevator Digital Twin platform from a
  backup folder produced by scripts\backup.ps1.

.DESCRIPTION
  Without -Force this is a DRY RUN: it validates the backup folder and
  prints exactly what would happen, then exits. Nothing is touched.
  -Force is the explicit confirmation gate (no interactive prompt, so the
  script also works in non-interactive shells).

  Targets:
    pg     restore the PostgreSQL dump. By default into a NEW database named
           by -Database (safe rehearsal); restoring over the live
           smart_building DB requires typing it explicitly:
           -Database smart_building -Force
    n8n    restore the n8n workflow/credential export (or unpack the
           volume tar fallback - printed instructions, manual step).
    mongo  restore the Ditto MongoDB archive (mongorestore --archive).
    mqtt   unpack mqtt_config.zip over infra\mqtt (broker restart required).

.PARAMETER BackupDir
  Path to a backups\<stamp> folder created by backup.ps1.

.PARAMETER Target
  One of: pg | n8n | mongo | mqtt

.PARAMETER Database
  (pg only) target database name. Default: smart_building_restore_test -
  a scratch DB that is created if missing, so a drill never touches live data.

.PARAMETER Force
  Actually execute. Omit for a dry run.

.EXAMPLE
  # rehearsal: restore into a scratch DB, verify, then drop it
  powershell -File scripts\restore.ps1 -BackupDir backups\2026-07-04_120000 -Target pg -Force
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$BackupDir,
  [Parameter(Mandatory = $true)][ValidateSet("pg", "n8n", "mongo", "mqtt")][string]$Target,
  [string]$Database = "smart_building_restore_test",
  [switch]$Force,
  [switch]$Help
)

if ($Help) { Get-Help $MyInvocation.MyCommand.Path -Detailed; exit 0 }

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $repoRoot

if (-not (Test-Path $BackupDir)) { throw "Backup folder not found: $BackupDir" }
$mode = "DRY RUN (add -Force to execute)"
if ($Force) { $mode = "EXECUTE" }
Write-Host "Restore target=$Target from $BackupDir  [$mode]"

switch ($Target) {
  "pg" {
    $dump = Join-Path $BackupDir "postgres_smart_building.sql"
    if (-not (Test-Path $dump)) { throw "missing $dump" }
    Write-Host "Plan: create database '$Database' if missing on elevator_db, then psql -f the dump into it."
    if ($Database -eq "smart_building") {
      Write-Host "WARNING: this targets the LIVE database. Objects that already exist will error/skip; for a clean overwrite drop the DB first (manual, deliberate)." -ForegroundColor Yellow
    }
    if (-not $Force) { break }
    docker cp $dump elevator_db:/tmp/restore.sql | Out-Null
    docker exec elevator_db psql -U admin -d postgres -v ON_ERROR_STOP=0 -c "CREATE DATABASE $Database" 2>$null
    docker exec elevator_db psql -U admin -d $Database -v ON_ERROR_STOP=0 -q -f /tmp/restore.sql
    if ($LASTEXITCODE -ne 0) { throw "psql restore exited $LASTEXITCODE" }
    docker exec elevator_db rm -f /tmp/restore.sql
    Write-Host "Restored dump into database '$Database'."
  }
  "n8n" {
    $wf = Join-Path $BackupDir "n8n_workflows.json"
    $tar = Join-Path $BackupDir "n8n_data.tgz"
    if (Test-Path $wf) {
      Write-Host "Plan: n8n import:workflow --input=(workflows) and import:credentials --input=(credentials) inside elevator_agents."
      if (-not $Force) { break }
      docker cp $wf elevator_agents:/tmp/n8n_workflows.json | Out-Null
      docker exec elevator_agents n8n import:workflow --input=/tmp/n8n_workflows.json
      $cred = Join-Path $BackupDir "n8n_credentials.json"
      if (Test-Path $cred) {
        docker cp $cred elevator_agents:/tmp/n8n_credentials.json | Out-Null
        docker exec elevator_agents n8n import:credentials --input=/tmp/n8n_credentials.json
      }
      docker exec elevator_agents rm -f /tmp/n8n_workflows.json /tmp/n8n_credentials.json
      Write-Host "n8n import done (encrypted credentials only decrypt with the original n8n encryption key)."
    } elseif (Test-Path $tar) {
      Write-Host "Volume-tar fallback found. Manual plan (destructive to current n8n data):"
      Write-Host "  docker compose stop n8n"
      Write-Host "  docker run --rm --volumes-from elevator_agents -v ${BackupDir}:/backup alpine sh -c 'rm -rf /home/node/.n8n/* && tar xzf /backup/n8n_data.tgz -C /'"
      Write-Host "  docker compose start n8n"
      Write-Host "(not automated on purpose - it wipes the live n8n volume)"
    } else { throw "no n8n artifacts in $BackupDir" }
  }
  "mongo" {
    $archive = Join-Path $BackupDir "ditto_mongodb.archive"
    if (-not (Test-Path $archive)) { throw "missing $archive" }
    $mongoName = docker ps --format "{{.Names}}" | Select-String -Pattern "mongo" | Select-Object -First 1 -ExpandProperty Line
    if (-not $mongoName) { throw "no running mongo container (start the Ditto stack first)" }
    Write-Host "Plan: mongorestore --archive --drop inside $mongoName (REPLACES current Ditto state)."
    if (-not $Force) { break }
    docker cp $archive "${mongoName}:/tmp/ditto.archive" | Out-Null
    docker exec $mongoName mongorestore --archive=/tmp/ditto.archive --drop --quiet
    if ($LASTEXITCODE -ne 0) { throw "mongorestore exited $LASTEXITCODE" }
    docker exec $mongoName rm -f /tmp/ditto.archive
    Write-Host "Ditto MongoDB restored. Restart the Ditto stack services to be safe."
  }
  "mqtt" {
    $zip = Join-Path $BackupDir "mqtt_config.zip"
    if (-not (Test-Path $zip)) { throw "missing $zip" }
    Write-Host "Plan: expand mqtt_config.zip over infra\mqtt (existing files overwritten), then restart the broker."
    if (-not $Force) { break }
    Expand-Archive -Path $zip -DestinationPath "infra\mqtt" -Force
    Write-Host "infra\mqtt restored. Run: docker compose restart mosquitto"
  }
}

if (-not $Force) { Write-Host "Dry run complete - nothing was changed." }
