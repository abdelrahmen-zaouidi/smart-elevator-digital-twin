<#
=====================================================================================
 setup-pc-ntp-server.ps1
 -------------------------------------------------------------------------------------
 Make THIS PC (the MQTT/Ditto host, 192.168.10.10) a LOCAL NTP server for the
 ISOLATED elevator LAN (192.168.10.0/24), so the ESP32-S3 can obtain accurate time
 for MQTT TLS even though the D-Link DSL-2750U has no internet/RTC.

 Why: TLS cert validity needs a real clock. The elevator LAN has no internet, so the
 ESP32 cannot reach pool.ntp.org and the router clock drifts. This PC has accurate
 time from a second (Wi-Fi) uplink, so it becomes the LAN time authority.

 What it does (all require Administrator):
   1. Point W32Time at reliable upstream NTP (over the Wi-Fi uplink) and resync,
      so this PC is itself synchronized (serves a valid stratum, not "unsynced").
   2. Enable the W32Time NTP *server* provider (NtpServer Enabled = 1).
   3. AnnounceFlags = 5  -> always announce as a reliable time source (standalone).
   4. Restart W32Time and force a resync.
   5. Open inbound UDP 123 (NTP) for the elevator LAN subnet only.
   6. Verify (status + self stripchart).

 Run it (it self-elevates via UAC if needed):
   powershell -ExecutionPolicy Bypass -File scripts\setup-pc-ntp-server.ps1
 Undo later if you ever want to:
   scripts\setup-pc-ntp-server.ps1 -Disable
=====================================================================================
#>
[CmdletBinding()]
param(
  [string]$LanSubnet    = "192.168.10.0/24",
  [string]$UpstreamNtp  = "pool.ntp.org,0x9 time.windows.com,0x9 time.nist.gov,0x9",
  [int]   $ClientPoll   = 1024,   # how often THIS PC re-syncs upstream (seconds)
  [switch]$Disable                # revert: turn the NTP server role back off
)

$ErrorActionPreference = "Stop"
$RuleName = "Elevator LAN NTP (UDP 123 in)"

# --- self-elevate via UAC if not already admin --------------------------------
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $pr.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
  Write-Host "Not elevated -> relaunching with UAC..." -ForegroundColor Yellow
  $argList = @("-NoExit","-NoProfile","-ExecutionPolicy","Bypass","-File","`"$PSCommandPath`"",
               "-LanSubnet","`"$LanSubnet`"","-UpstreamNtp","`"$UpstreamNtp`"","-ClientPoll",$ClientPoll)
  if ($Disable) { $argList += "-Disable" }
  Start-Process powershell.exe -Verb RunAs -ArgumentList $argList
  return
}

$NtpServerKey = "HKLM:\SYSTEM\CurrentControlSet\Services\W32Time\TimeProviders\NtpServer"
$NtpClientKey = "HKLM:\SYSTEM\CurrentControlSet\Services\W32Time\TimeProviders\NtpClient"
$ConfigKey    = "HKLM:\SYSTEM\CurrentControlSet\Services\W32Time\Config"

if ($Disable) {
  Write-Host "== Reverting: disabling the NTP server role ==" -ForegroundColor Cyan
  Set-ItemProperty $NtpServerKey -Name Enabled -Value 0 -Type DWord
  Set-ItemProperty $ConfigKey    -Name AnnounceFlags -Value 10 -Type DWord
  if (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue) {
    Remove-NetFirewallRule -DisplayName $RuleName
  }
  Restart-Service w32time
  Write-Host "Done. NTP server role disabled, firewall rule removed." -ForegroundColor Green
  return
}

Write-Host "== 1/6 Sync THIS PC from upstream NTP + mark it RELIABLE ==" -ForegroundColor Cyan
# manualpeerlist + syncfromflags:manual: the PC disciplines its own clock from the
# internet (via the Wi-Fi uplink) when reachable, so it serves accurate time.
# /reliable:yes (with AnnounceFlags=5 below): KEEP SERVING even when the upstream is
# UNREACHABLE -- the PC then hands out its own persisted clock instead of refusing,
# so the elevator LAN stays time-functional with NO internet at all.
& w32tm /config /manualpeerlist:"$UpstreamNtp" /syncfromflags:manual /reliable:yes /update | Out-Null
Set-ItemProperty $NtpClientKey -Name SpecialPollInterval -Value $ClientPoll -Type DWord -ErrorAction SilentlyContinue

Write-Host "== 2/6 Enable the W32Time NTP SERVER provider ==" -ForegroundColor Cyan
Set-ItemProperty $NtpServerKey -Name Enabled -Value 1 -Type DWord

Write-Host "== 3/6 AnnounceFlags = 5 (always announce as reliable time source) ==" -ForegroundColor Cyan
Set-ItemProperty $ConfigKey -Name AnnounceFlags -Value 5 -Type DWord

Write-Host "== 4/6 Restart W32Time + resync ==" -ForegroundColor Cyan
Set-Service w32time -StartupType Automatic
Restart-Service w32time
Start-Sleep -Seconds 2
& w32tm /resync /rediscover 2>&1 | Out-Null
Start-Sleep -Seconds 2

Write-Host "== 5/6 Firewall: allow inbound UDP 123 from $LanSubnet only ==" -ForegroundColor Cyan
if (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue) {
  Set-NetFirewallRule -DisplayName $RuleName -RemoteAddress $LanSubnet -Enabled True
  Write-Host "  (rule already existed - updated scope)" -ForegroundColor DarkGray
} else {
  New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Protocol UDP `
    -LocalPort 123 -RemoteAddress $LanSubnet -Action Allow -Profile Any | Out-Null
}

Write-Host "`n== 6/6 Verification ==" -ForegroundColor Cyan
& w32tm /query /status
Write-Host "`n-- self NTP probe (offsets, NOT 0x800705B4, mean the server answers) --" -ForegroundColor Cyan
& w32tm /stripchart /computer:127.0.0.1 /samples:2 /dataonly

Write-Host "`nWhen the Wi-Fi uplink is up: status shows 'synchronized' (accurate)." -ForegroundColor Green
Write-Host "When OFFLINE: the PC still answers NTP from its own persisted clock" -ForegroundColor Green
Write-Host "(reliable flag) -> the elevator LAN stays time-functional with no internet." -ForegroundColor Green
Write-Host "ESP32 syncs time from $($env:COMPUTERNAME) at the broker host IP. Done." -ForegroundColor Green
