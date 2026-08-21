[CmdletBinding()]
param(
    [ValidateRange(1, 300)]
    [int]$TimeoutSeconds = 90,
    [string]$HealthUrl = 'http://127.0.0.1:8787/health',
    [ValidateRange(1, 100)]
    [int]$StableChecks = 8
)

$ErrorActionPreference = 'Stop'
$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
$successfulChecks = 0

do {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            $successfulChecks += 1
            if ($successfulChecks -ge $StableChecks) {
                Write-Host "[LightTable] Local MCP is stable and ready: $HealthUrl"
                exit 0
            }
        }
    } catch {
        $successfulChecks = 0
    }
    Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $deadline)

Write-Error "Local MCP did not become ready within $TimeoutSeconds seconds: $HealthUrl"
exit 1
