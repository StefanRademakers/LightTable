param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath
)

$ErrorActionPreference = 'Stop'
$target = [System.IO.Path]::GetFullPath($ExecutablePath)
$running = @(
  Get-CimInstance Win32_Process | Where-Object {
    if (-not $_.ExecutablePath) { return $false }
    try {
      [System.IO.Path]::GetFullPath($_.ExecutablePath).Equals(
        $target,
        [System.StringComparison]::OrdinalIgnoreCase
      )
    } catch {
      $false
    }
  }
)

if ($running.Count -eq 0) { exit 0 }

$processIds = ($running | ForEach-Object { $_.ProcessId }) -join ', '
Write-Host "[LightTable] The production package is still running (processes: $processIds)." -ForegroundColor Red
Write-Host '[LightTable] Close that LightTable window before rebuilding; it locks Electron files in out-local-release.' -ForegroundColor Red
Write-Host '[LightTable] The build did not start, so no generated package was changed.'
exit 1
