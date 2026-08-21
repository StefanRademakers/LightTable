param(
  [string]$Source = 'D:\mediavibe\LightTableTestFiles\RandomFiles\people.jpg',
  [string]$Root = 'D:\mediavibe\LightTableTests\GradeCurvesParity',
  [string]$CasePath = ''
)

$ErrorActionPreference = 'Stop'
$sourcePath = [IO.Path]::GetFullPath($Source)
$rootPath = [IO.Path]::GetFullPath($Root)
$outputPath = Join-Path $rootPath 'camera-raw'
$casePath = if ($CasePath) { [IO.Path]::GetFullPath($CasePath) } else { Join-Path $PSScriptRoot 'grade-curves-parity-cases.json' }
$stablePhotoshopPath = 'C:\Program Files\Adobe\Adobe Photoshop 2026\Photoshop.exe'
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Missing source: $sourcePath" }
if (-not (Test-Path -LiteralPath $casePath -PathType Leaf)) { throw "Missing cases: $casePath" }
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null

function Get-PhotoshopAutomation {
  try { $application = [Runtime.InteropServices.Marshal]::GetActiveObject('Photoshop.Application') }
  catch { $application = $null }
  if ($application -and $application.Path -like '*Adobe Photoshop 2026*') { return $application }
  if ($application) { throw "Unexpected Photoshop automation host: $($application.Path)" }
  Start-Process -FilePath $stablePhotoshopPath -ArgumentList '/Automation' -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(90)
  do {
    Start-Sleep -Milliseconds 500
    try { $application = [Runtime.InteropServices.Marshal]::GetActiveObject('Photoshop.Application') }
    catch { $application = $null }
  } until ($application -or (Get-Date) -gt $deadline)
  if (-not $application) { throw 'Photoshop 2026 did not publish its automation object.' }
  return $application
}

function ConvertTo-JsString([string]$value) {
  return '"' + $value.Replace('\', '/').Replace('"', '\"') + '"'
}

$suite = Get-Content -LiteralPath $casePath -Raw | ConvertFrom-Json
$caseManifestSha256 = (Get-FileHash -LiteralPath $casePath -Algorithm SHA256).Hash.ToLowerInvariant()
$sourceItem = Get-Item -LiteralPath $sourcePath
$sourceEvidence = [ordered]@{
  sha256 = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
  byteLength = $sourceItem.Length
}
$photoshop = Get-PhotoshopAutomation
$channelDescriptors = @{ master = 'Crv '; red = 'CrvR'; green = 'CrvG'; blue = 'CrvB' }
$results = @()
foreach ($case in $suite.cases) {
  $statements = @()
  foreach ($property in $case.curves.psobject.Properties) {
    $values = @($property.Value | ForEach-Object { @($_)[0]; @($_)[1] })
    $putValues = ($values | ForEach-Object { "curve.putInteger($([int]$_));" }) -join ' '
    $statements += "var curve = new ActionList(); $putValues settings.putList(c2t('$($channelDescriptors[$property.Name])'), curve);"
  }
  if (-not $statements.Count) { $statements = @("settings.putDouble(c2t('Ex12'), 0.0);") }
  $target = Join-Path $outputPath "$($case.id).png"
  $jsx = @"
(function () {
  function c2t(value) { return charIDToTypeID(value); }
  function s2t(value) { return stringIDToTypeID(value); }
  var document = app.open(new File($(ConvertTo-JsString $sourcePath)));
  try {
    var settings = new ActionDescriptor();
    $($statements -join "`n    ")
    executeAction(s2t('Adobe Camera Raw Filter'), settings, DialogModes.NO);
    var options = new PNGSaveOptions(); options.compression = 0;
    document.saveAs(new File($(ConvertTo-JsString $target)), options, true, Extension.LOWERCASE);
    return document.width.as('px') + 'x' + document.height.as('px');
  } finally { document.close(SaveOptions.DONOTSAVECHANGES); }
}());
"@
  $dimensions = $photoshop.DoJavaScript($jsx)
  $results += [ordered]@{
    id = $case.id; key = $case.key; label = $case.label; value = $case.value
    baselineId = 'neutral'; isBaseline = ($case.id -eq 'neutral'); output = $target; dimensions = $dimensions
  }
  Write-Host "Camera Raw $($case.id): $target"
}

$cameraRawPlugin = Get-Item -LiteralPath 'C:\Program Files\Common Files\Adobe\Plug-Ins\CC\File Formats\Camera Raw.8bi' -ErrorAction SilentlyContinue
[ordered]@{
  schema = 1; generatedAt = (Get-Date).ToUniversalTime().ToString('o'); section = $suite.section; source = $sourcePath
  sourceEvidence = $sourceEvidence
  caseManifestSha256 = $caseManifestSha256
  photoshopVersion = $photoshop.Version; photoshopPath = $photoshop.Path
  cameraRawVersion = if ($cameraRawPlugin) { $cameraRawPlugin.VersionInfo.ProductVersion } else { $null }
  isolation = 'Each output opens the source afresh and authors only the declared Camera Raw point-curve lists.'
  cases = $results
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputPath 'capture-report.json') -Encoding utf8
