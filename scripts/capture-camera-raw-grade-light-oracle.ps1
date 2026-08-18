param(
  [string]$Source = 'D:\people.jpg',
  [string]$Root = 'D:\mediavibe\LightTableTests\GradeLightParity',
  [string]$CasePath = ''
)

$ErrorActionPreference = 'Stop'
$sourcePath = [IO.Path]::GetFullPath($Source)
$rootPath = [IO.Path]::GetFullPath($Root)
$outputPath = Join-Path $rootPath 'camera-raw'
$casePath = if ($CasePath) { [IO.Path]::GetFullPath($CasePath) } else {
  Join-Path $PSScriptRoot 'grade-light-parity-cases.json'
}
$stablePhotoshopPath = 'C:\Program Files\Adobe\Adobe Photoshop 2026\Photoshop.exe'

if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "Grade Light oracle source is missing: $sourcePath"
}
if (-not (Test-Path -LiteralPath $casePath -PathType Leaf)) {
  throw "Grade Light parity cases are missing: $casePath"
}
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null

function Get-PhotoshopAutomation {
  try {
    $application = [Runtime.InteropServices.Marshal]::GetActiveObject('Photoshop.Application')
  } catch {
    $application = $null
  }
  if ($application -and $application.Path -like '*Adobe Photoshop 2026*') {
    return $application
  }
  if ($application) {
    throw "The active Photoshop automation object is not stable Photoshop 2026: $($application.Path)"
  }
  if (-not (Test-Path -LiteralPath $stablePhotoshopPath -PathType Leaf)) {
    throw "Stable Photoshop 2026 is missing: $stablePhotoshopPath"
  }
  Start-Process -FilePath $stablePhotoshopPath -ArgumentList '/Automation' -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(90)
  do {
    Start-Sleep -Milliseconds 500
    try {
      $application = [Runtime.InteropServices.Marshal]::GetActiveObject('Photoshop.Application')
    } catch {
      $application = $null
    }
  } until ($application -or (Get-Date) -gt $deadline)
  if (-not $application) {
    throw 'Photoshop 2026 did not publish its automation object.'
  }
  if ($application.Path -notlike '*Adobe Photoshop 2026*') {
    throw "Photoshop automation resolved to an unexpected install: $($application.Path)"
  }
  return $application
}

function ConvertTo-JsString([string]$value) {
  return '"' + $value.Replace('\', '/').Replace('"', '\"') + '"'
}

function Get-CaseId([string]$key, [double]$value) {
  $valueId = if ($value -lt 0) { "minus-$([Math]::Abs($value))" } else { "plus-$value" }
  return "$key-$valueId".Replace('.0', '').Replace('.', '_')
}

$suite = Get-Content -LiteralPath $casePath -Raw | ConvertFrom-Json
$photoshop = Get-PhotoshopAutomation
$cases = @([pscustomobject]@{
  id = 'neutral'
  key = $null
  label = 'Neutral'
  value = 0
  cameraRawDescriptor = $null
  cameraRawDescriptorType = $null
  cameraRawValueType = $null
})
foreach ($control in $suite.controls) {
  foreach ($value in $control.values) {
    $cases += [pscustomobject]@{
      id = Get-CaseId $control.key $value
      key = $control.key
      label = $control.label
      value = $value
      cameraRawDescriptor = $control.cameraRawDescriptor
      cameraRawDescriptorType = $control.cameraRawDescriptorType
      cameraRawValueType = $control.cameraRawValueType
    }
  }
}

$results = @()
foreach ($case in $cases) {
  $target = Join-Path $outputPath "$($case.id).png"
  $descriptorStatement = if ($case.cameraRawDescriptor) {
    $method = if ($case.cameraRawValueType -eq 'double') { 'putDouble' } else { 'putInteger' }
    $idFunction = if ($case.cameraRawDescriptorType -eq 'string') {
      'stringIDToTypeID'
    } else {
      'charIDToTypeID'
    }
    "settings.$method($idFunction('$($case.cameraRawDescriptor)'), $($case.value));"
  } else {
    # A known neutral PV2012 key makes the process version explicit without
    # changing the pixels. An empty descriptor can inherit Camera Raw defaults.
    "settings.putDouble(charIDToTypeID('Ex12'), 0.0);"
  }
  $jsx = @"
(function () {
  var document = app.open(new File($(ConvertTo-JsString $sourcePath)));
  try {
    var settings = new ActionDescriptor();
    $descriptorStatement
    executeAction(stringIDToTypeID('Adobe Camera Raw Filter'), settings, DialogModes.NO);
    var options = new PNGSaveOptions();
    options.compression = 0;
    document.saveAs(new File($(ConvertTo-JsString $target)), options, true, Extension.LOWERCASE);
    return document.width.as('px') + 'x' + document.height.as('px');
  } finally {
    document.close(SaveOptions.DONOTSAVECHANGES);
  }
}());
"@
  $dimensions = $photoshop.DoJavaScript($jsx)
  $results += [ordered]@{
    id = $case.id
    key = $case.key
    label = $case.label
    value = $case.value
    descriptor = $case.cameraRawDescriptor
    output = $target
    dimensions = $dimensions
  }
  Write-Host "Camera Raw $($case.id): $target"
}

$cameraRawPlugin = Get-Item -LiteralPath `
  'C:\Program Files\Common Files\Adobe\Plug-Ins\CC\File Formats\Camera Raw.8bi' `
  -ErrorAction SilentlyContinue
$report = [ordered]@{
  schema = 1
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  section = $suite.section
  source = $sourcePath
  photoshopVersion = $photoshop.Version
  photoshopPath = $photoshop.Path
  cameraRawVersion = if ($cameraRawPlugin) { $cameraRawPlugin.VersionInfo.ProductVersion } else { $null }
  isolation = 'Each output opens the source afresh and authors exactly one PV2012 Camera Raw control.'
  cases = $results
}
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath `
  (Join-Path $outputPath 'capture-report.json') -Encoding utf8
