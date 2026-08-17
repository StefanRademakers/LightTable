param(
  [string]$Source = 'D:\people.jpg',
  [string]$Output = 'D:\mediavibe\LightTableTests\DetailParity\camera-raw'
)

$ErrorActionPreference = 'Stop'
$sourcePath = [IO.Path]::GetFullPath($Source)
$outputPath = [IO.Path]::GetFullPath($Output)
$stablePhotoshopPath = 'C:\Program Files\Adobe\Adobe Photoshop 2026\Photoshop.exe'

if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "Detail oracle source is missing: $sourcePath"
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

function JsString([string]$value) {
  return '"' + $value.Replace('\', '/').Replace('"', '\"') + '"'
}

$photoshop = Get-PhotoshopAutomation
$cases = @(
  @{ id = 'neutral'; luminanceNoiseReduction = 0 },
  @{ id = 'luminance-25'; luminanceNoiseReduction = 25 },
  @{ id = 'luminance-50'; luminanceNoiseReduction = 50 },
  @{ id = 'luminance-80'; luminanceNoiseReduction = 80 },
  @{ id = 'luminance-100'; luminanceNoiseReduction = 100 }
)
$results = @()
foreach ($case in $cases) {
  $target = Join-Path $outputPath "$($case.id).png"
  $jsx = @"
(function () {
  var document = app.open(new File($(JsString $sourcePath)));
  try {
    var settings = new ActionDescriptor();
    settings.putInteger(charIDToTypeID('LNR '), $($case.luminanceNoiseReduction));
    executeAction(stringIDToTypeID('Adobe Camera Raw Filter'), settings, DialogModes.NO);
    var options = new PNGSaveOptions();
    options.compression = 0;
    document.saveAs(new File($(JsString $target)), options, true, Extension.LOWERCASE);
    return document.width.as('px') + 'x' + document.height.as('px');
  } finally {
    document.close(SaveOptions.DONOTSAVECHANGES);
  }
}());
"@
  $dimensions = $photoshop.DoJavaScript($jsx)
  $results += [ordered]@{
    id = $case.id
    luminanceNoiseReduction = $case.luminanceNoiseReduction
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
  source = $sourcePath
  photoshopVersion = $photoshop.Version
  photoshopPath = $photoshop.Path
  cameraRawVersion = if ($cameraRawPlugin) { $cameraRawPlugin.VersionInfo.ProductVersion } else { $null }
  isolation = 'Only the LNR descriptor differs between neutral and luminance-100.'
  cases = $results
}
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath `
  (Join-Path $outputPath 'capture-report.json') -Encoding utf8
