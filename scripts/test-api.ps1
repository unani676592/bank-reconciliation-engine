# ============================================================
# PowerShell smoke test for the reconciliation API (Windows).
#
# Reads the three reference CSVs, converts them to JSON, POSTs them to
# the running server, prints the summary + notes + problem rows, and
# checks that all 10 planted problems are present.
#
# Usage (PowerShell):
#   1. In one terminal:   npm run dev
#   2. In another:        .\scripts\test-api.ps1
#
# Optional parameters:
#   -BaseUrl  http://localhost:3000   (default)
#   -ApiKey   your key                (default: reads $env:RECON_API_KEY)
# ============================================================

param(
    [string]$BaseUrl = "http://localhost:3000",
    [string]$ApiKey  = ""
)

$ErrorActionPreference = "Stop"

# Resolve paths relative to this script so it works from any directory.
$root      = Split-Path -Parent $PSScriptRoot
$refDir    = Join-Path $root "test\fixtures"
$envFile   = Join-Path $root ".env"
$endpoint  = "$BaseUrl/api/reconcile"

# Read a single KEY=VALUE from the .env file. This is the SAME file the
# server reads, so the script always sends the key the server loaded.
# Get-Content strips line endings, so CRLF is handled; we also Trim() and
# strip surrounding quotes to mirror src/load-env.js exactly.
function Get-DotEnvValue([string]$path, [string]$name) {
    if (-not (Test-Path $path)) { return $null }
    foreach ($line in Get-Content -Path $path) {
        $trimmed = $line.Trim()
        if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
        $eq = $trimmed.IndexOf("=")
        if ($eq -lt 0) { continue }
        $k = $trimmed.Substring(0, $eq).Trim()
        if ($k -ne $name) { continue }
        $v = $trimmed.Substring($eq + 1).Trim()
        if (($v.StartsWith('"') -and $v.EndsWith('"')) -or
            ($v.StartsWith("'") -and $v.EndsWith("'"))) {
            $v = $v.Substring(1, $v.Length - 2)
        }
        return $v
    }
    return $null
}

# Key precedence: explicit -ApiKey, then .env (server's source of truth),
# then the session environment variable as a last resort.
if ([string]::IsNullOrWhiteSpace($ApiKey)) {
    $ApiKey = Get-DotEnvValue $envFile "RECON_API_KEY"
}
if ([string]::IsNullOrWhiteSpace($ApiKey)) {
    $ApiKey = $env:RECON_API_KEY
}
if ([string]::IsNullOrWhiteSpace($ApiKey)) {
    Write-Error "No API key. Set RECON_API_KEY in .env (recommended) or pass -ApiKey."
    exit 1
}

# Show only the LENGTH so you can compare with the server's startup log.
# The key itself is never printed.
Write-Host ("Using API key of length {0}" -f $ApiKey.Trim().Length) -ForegroundColor DarkGray
$ApiKey = $ApiKey.Trim()

# Import-Csv gives objects with ALL columns; the server keeps only the 5
# allowed fields, so sending everything is a fair test of that filtering.
function Read-Rows($fileName) {
    $path = Join-Path $refDir $fileName
    if (-not (Test-Path $path)) { throw "Missing reference file: $path" }
    return @(Import-Csv -Path $path)
}

$payload = @{
    bank_a = Read-Rows "bank_a.csv"
    bank_b = Read-Rows "bank_b.csv"
    ledger = Read-Rows "ledger.csv"
}

$json = $payload | ConvertTo-Json -Depth 5

Write-Host "POST $endpoint" -ForegroundColor Cyan
Write-Host ("Sending: bank_a={0} bank_b={1} ledger={2} rows" -f `
    $payload.bank_a.Count, $payload.bank_b.Count, $payload.ledger.Count)

try {
    $response = Invoke-RestMethod -Uri $endpoint -Method Post -Body $json `
        -ContentType "application/json" -Headers @{ "x-api-key" = $ApiKey }
}
catch {
    Write-Error "Request failed: $($_.Exception.Message)"
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
    exit 1
}

Write-Host ""
Write-Host "Summary:" -ForegroundColor Green
$response.summary | Format-List

if ($response.notes -and $response.notes.Count -gt 0) {
    Write-Host "Notes:" -ForegroundColor Yellow
    $response.notes | ForEach-Object { Write-Host "  - $_" }
    Write-Host ""
}

Write-Host ("saved: {0}" -f $response.saved)
if ($response.warning) { Write-Host ("warning: {0}" -f $response.warning) -ForegroundColor Yellow }
Write-Host ""

Write-Host "Problem rows (Error/Warning):" -ForegroundColor Green
$response.results |
    Where-Object { $_.severity -ne "OK" } |
    Select-Object tx_id, severity, days_diff, note, status |
    Format-Table -AutoSize

# ---- assert the 9 planted problems are all present (v2 rules) ----
# TXB-2003 is no longer a problem: its 1-day lag is within the tolerance window.
$expected = @(
    "TXA-1007","TXB-2012","TXL-9001","TXL-9002","TXA-1004",
    "TXB-2009","TXA-1011","TXB-2005","TXA-1006"
)
$foundIds = $response.results | Where-Object { $_.severity -ne "OK" } | ForEach-Object { $_.tx_id }
$missing  = $expected | Where-Object { $foundIds -notcontains $_ }

# TXB-2003 should be Matched with a "posted 1 day late" note.
$txb2003 = $response.results | Where-Object { $_.tx_id -eq "TXB-2003" }
$lateOk  = $txb2003 -and $txb2003.severity -eq "OK" -and $txb2003.note -eq "posted 1 day late"

if ($missing.Count -eq 0 -and $foundIds.Count -eq 9 -and $lateOk) {
    Write-Host "PASS: 9 planted problems found; TXB-2003 Matched ('posted 1 day late')." -ForegroundColor Green
    exit 0
} else {
    if ($missing.Count -gt 0) { Write-Host ("FAIL: missing problems: {0}" -f ($missing -join ", ")) -ForegroundColor Red }
    if ($foundIds.Count -ne 9) { Write-Host ("FAIL: expected 9 problems, found {0}" -f $foundIds.Count) -ForegroundColor Red }
    if (-not $lateOk) { Write-Host "FAIL: TXB-2003 was not Matched with 'posted 1 day late'." -ForegroundColor Red }
    exit 1
}
