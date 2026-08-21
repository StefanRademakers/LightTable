[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ports = @(8787, 8788)
$listeners = @(
    Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalPort -in $ports }
)

if ($listeners.Count -gt 0) {
    $busy = ($listeners | Select-Object -ExpandProperty LocalPort -Unique | Sort-Object) -join ', '
    Write-Error "Local MCP port(s) already in use: $busy"
    exit 1
}

Write-Host '[LightTable] Local MCP ports 8787 and 8788 are available.'
