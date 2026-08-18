param(
  [string]$TargetPath = 'C:\Program Files\Adobe\Adobe Photoshop 2026\Photoshop.exe',
  [string]$ProgId = 'Photoshop.Application',
  [string]$ExpectedVersion = '27.9',
  [int]$TimeoutSeconds = 90,
  [switch]$Launch,
  [string]$ReportPath = ''
)

$ErrorActionPreference = 'Stop'

function Get-DocumentEvidence($Application) {
  $documents = @()
  for ($index = 1; $index -le $Application.Documents.Count; $index += 1) {
    $document = $Application.Documents.Item($index)
    $documents += [ordered]@{
      name = [string]$document.Name
      saved = [bool]$document.Saved
    }
  }
  return $documents
}

function Get-ActivePhotoshop([string]$AutomationProgId) {
  try {
    return [Runtime.InteropServices.Marshal]::GetActiveObject($AutomationProgId)
  } catch {
    return $null
  }
}

function Get-AnyActivePhotoshop([string]$PreferredProgId) {
  $candidates = @($PreferredProgId, 'Photoshop.Application', 'Photoshop.Application.200',
    'Photoshop.Application.190', 'Photoshop.Application.BETA') | Select-Object -Unique
  foreach ($candidate in $candidates) {
    $candidateApplication = Get-ActivePhotoshop $candidate
    if ($candidateApplication) {
      return [ordered]@{ progId = $candidate; application = $candidateApplication }
    }
  }
  return $null
}

function Get-RegisteredServer([string]$AutomationProgId) {
  $progIdKey = "Registry::HKEY_CLASSES_ROOT\$AutomationProgId\CLSID"
  if (-not (Test-Path -LiteralPath $progIdKey)) { return $null }
  $classId = (Get-Item -LiteralPath $progIdKey).GetValue('')
  if (-not $classId) { return $null }
  $serverKey = "Registry::HKEY_CLASSES_ROOT\CLSID\$classId\LocalServer32"
  if (-not (Test-Path -LiteralPath $serverKey)) { return $null }
  return [ordered]@{
    classId = [string]$classId
    command = [string](Get-Item -LiteralPath $serverKey).GetValue('')
  }
}

function Write-PreflightResult([System.Collections.IDictionary]$Result, [int]$ExitCode) {
  $Result['generatedAt'] = (Get-Date).ToUniversalTime().ToString('o')
  $Result['targetPath'] = $resolvedTargetPath
  $Result['progId'] = $ProgId
  $Result['expectedVersion'] = $ExpectedVersion
  $json = $Result | ConvertTo-Json -Depth 8
  if ($ReportPath) {
    $resolvedReportPath = [IO.Path]::GetFullPath($ReportPath)
    $parent = Split-Path -Parent $resolvedReportPath
    if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    Set-Content -LiteralPath $resolvedReportPath -Value $json -Encoding utf8
  }
  Write-Output $json
  exit $ExitCode
}

$resolvedTargetPath = [IO.Path]::GetFullPath($TargetPath)
$registeredServer = Get-RegisteredServer $ProgId
$running = @(Get-CimInstance Win32_Process -Filter "Name='Photoshop.exe'" | ForEach-Object {
  [ordered]@{
    processId = [int]$_.ProcessId
    executablePath = [string]$_.ExecutablePath
    commandLine = [string]$_.CommandLine
  }
})

$active = Get-AnyActivePhotoshop $ProgId
$application = if ($active) { $active.application } else { $null }
if ($application) {
  $activePath = [IO.Path]::GetFullPath((Join-Path ([string]$application.Path) 'Photoshop.exe'))
  $documents = @(Get-DocumentEvidence $application)
  $matchesPath = $activePath -ieq $resolvedTargetPath
  $matchesVersion = ([string]$application.Version).StartsWith($ExpectedVersion)
  if ($matchesPath -and $matchesVersion) {
    Write-PreflightResult ([ordered]@{
      status = 'ready'
      version = [string]$application.Version
      activePath = $activePath
      activeProgId = $active.progId
      documents = $documents
      registeredServer = $registeredServer
      runningProcesses = $running
    }) 0
  }
  Write-PreflightResult ([ordered]@{
    status = 'conflicting-active-version'
    message = 'The active Photoshop automation object does not match the version-pinned oracle.'
    version = [string]$application.Version
    activePath = $activePath
    activeProgId = $active.progId
    documents = $documents
    unsavedDocumentCount = @($documents | Where-Object { -not $_.saved }).Count
    registeredServer = $registeredServer
    runningProcesses = $running
  }) 2
}

if (-not (Test-Path -LiteralPath $resolvedTargetPath -PathType Leaf)) {
  Write-PreflightResult ([ordered]@{
    status = 'target-missing'
    message = 'The version-pinned Photoshop executable is not installed.'
    registeredServer = $registeredServer
    runningProcesses = $running
  }) 3
}

$conflictingProcesses = @($running | Where-Object { $_.executablePath -ine $resolvedTargetPath })
if ($conflictingProcesses.Count -gt 0) {
  Write-PreflightResult ([ordered]@{
    status = 'conflicting-process'
    message = 'Another Photoshop version is running; the target oracle will not be launched.'
    registeredServer = $registeredServer
    runningProcesses = $running
  }) 2
}

if (-not $Launch) {
  Write-PreflightResult ([ordered]@{
    status = 'process-absent'
    message = 'The target Photoshop oracle is not active. Use -Launch to start it explicitly.'
    registeredServer = $registeredServer
    runningProcesses = $running
  }) 4
}

Start-Process -FilePath $resolvedTargetPath -ArgumentList '/Automation' -WindowStyle Hidden
$deadline = (Get-Date).AddSeconds([Math]::Max(1, $TimeoutSeconds))
do {
  Start-Sleep -Milliseconds 500
  $application = Get-ActivePhotoshop $ProgId
  if ($application) { break }
} until ((Get-Date) -ge $deadline)

if (-not $application) {
  Write-PreflightResult ([ordered]@{
    status = 'automation-object-absent'
    message = 'Photoshop started but did not publish the requested automation object before the deadline.'
    registeredServer = $registeredServer
    runningProcesses = @(Get-CimInstance Win32_Process -Filter "Name='Photoshop.exe'" | ForEach-Object {
      [ordered]@{ processId = [int]$_.ProcessId; executablePath = [string]$_.ExecutablePath }
    })
  }) 5
}

$activePath = [IO.Path]::GetFullPath((Join-Path ([string]$application.Path) 'Photoshop.exe'))
$documents = @(Get-DocumentEvidence $application)
if ($activePath -ine $resolvedTargetPath -or -not ([string]$application.Version).StartsWith($ExpectedVersion)) {
  Write-PreflightResult ([ordered]@{
    status = 'launched-version-mismatch'
    message = 'Automation resolved after launch, but to a different Photoshop installation.'
    version = [string]$application.Version
    activePath = $activePath
    documents = $documents
    registeredServer = $registeredServer
    runningProcesses = $running
  }) 6
}

Write-PreflightResult ([ordered]@{
  status = 'ready'
  version = [string]$application.Version
  activePath = $activePath
  documents = $documents
  registeredServer = $registeredServer
  runningProcesses = $running
}) 0
