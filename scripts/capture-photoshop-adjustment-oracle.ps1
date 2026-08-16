param(
  [string]$Source = 'D:\mediavibe\LightTableTests\ToneBrush\source\grayscale-ramp.png',
  [string]$Output = 'D:\mediavibe\LightTableTests\AdjustmentParity\exposure\photoshop'
)

$ErrorActionPreference = 'Stop'
$sourcePath = [IO.Path]::GetFullPath($Source)
$outputPath = [IO.Path]::GetFullPath($Output)
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "Adjustment oracle source is missing: $sourcePath"
}
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$psdPath = Join-Path ([IO.Directory]::GetParent($outputPath).FullName) 'psd'
New-Item -ItemType Directory -Path $psdPath -Force | Out-Null

function JsString([string]$value) {
  return '"' + $value.Replace('\', '/').Replace('"', '\"') + '"'
}

$cases = @(
  @{ id='neutral'; exposure=0.0; offset=0.0; gamma=1.0 },
  @{ id='exposure-neg-20'; exposure=-20.0; offset=0.0; gamma=1.0 },
  @{ id='exposure-neg-16'; exposure=-16.0; offset=0.0; gamma=1.0 },
  @{ id='exposure-neg-5'; exposure=-5.0; offset=0.0; gamma=1.0 },
  @{ id='exposure-neg-1'; exposure=-1.0; offset=0.0; gamma=1.0 },
  @{ id='exposure-pos-1'; exposure=1.0; offset=0.0; gamma=1.0 },
  @{ id='exposure-pos-5'; exposure=5.0; offset=0.0; gamma=1.0 },
  @{ id='exposure-pos-16'; exposure=16.0; offset=0.0; gamma=1.0 },
  @{ id='exposure-pos-20'; exposure=20.0; offset=0.0; gamma=1.0 },
  @{ id='offset-neg-0500'; exposure=0.0; offset=-0.5; gamma=1.0 },
  @{ id='offset-neg-0400'; exposure=0.0; offset=-0.4; gamma=1.0 },
  @{ id='offset-neg-0100'; exposure=0.0; offset=-0.1; gamma=1.0 },
  @{ id='offset-pos-0100'; exposure=0.0; offset=0.1; gamma=1.0 },
  @{ id='offset-pos-0400'; exposure=0.0; offset=0.4; gamma=1.0 },
  @{ id='offset-pos-0500'; exposure=0.0; offset=0.5; gamma=1.0 },
  @{ id='gamma-001'; exposure=0.0; offset=0.0; gamma=0.01 },
  @{ id='gamma-010'; exposure=0.0; offset=0.0; gamma=0.1 },
  @{ id='gamma-050'; exposure=0.0; offset=0.0; gamma=0.5 },
  @{ id='gamma-200'; exposure=0.0; offset=0.0; gamma=2.0 },
  @{ id='gamma-800'; exposure=0.0; offset=0.0; gamma=8.0 },
  @{ id='gamma-999'; exposure=0.0; offset=0.0; gamma=9.99 },
  @{ id='combined-80'; exposure=16.0; offset=0.4; gamma=8.0 },
  @{ id='combined-negative-80'; exposure=-16.0; offset=-0.4; gamma=0.1 }
)

$photoshop = $null
$results = @()
try {
  try { $photoshop = [Runtime.InteropServices.Marshal]::GetActiveObject('Photoshop.Application') }
  catch { $photoshop = New-Object -ComObject Photoshop.Application }
  $photoshop.DisplayDialogs = 3
  foreach ($case in $cases) {
    $target = Join-Path $outputPath "$($case.id).png"
    $psdTarget = Join-Path $psdPath "$($case.id).psd"
    $script = @"
var c2t = charIDToTypeID, s2t = stringIDToTypeID;
var previousRulerUnits = app.preferences.rulerUnits;
app.preferences.rulerUnits = Units.PIXELS;
var doc = app.open(new File($(JsString $sourcePath)));
try {
  var make = new ActionDescriptor();
  var adjustmentReference = new ActionReference();
  adjustmentReference.putClass(s2t('adjustmentLayer'));
  make.putReference(c2t('null'), adjustmentReference);
  var adjustmentLayer = new ActionDescriptor();
  var exposure = new ActionDescriptor();
  exposure.putDouble(s2t('exposure'), $($case.exposure));
  exposure.putDouble(s2t('offset'), $($case.offset));
  exposure.putDouble(s2t('gammaCorrection'), $($case.gamma));
  adjustmentLayer.putObject(s2t('type'), s2t('exposure'), exposure);
  make.putObject(s2t('using'), s2t('adjustmentLayer'), adjustmentLayer);
  executeAction(c2t('Mk  '), make, DialogModes.NO);

  var psd = new PhotoshopSaveOptions(); psd.layers = true; psd.maximizeCompatibility = true;
  doc.saveAs(new File($(JsString $psdTarget)), psd, true, Extension.LOWERCASE);
  var png = new PNGSaveOptions(); png.interlaced = false;
  doc.saveAs(new File($(JsString $target)), png, true, Extension.LOWERCASE);
  doc.close(SaveOptions.DONOTSAVECHANGES);
  app.preferences.rulerUnits = previousRulerUnits;
  '$($case.id)';
} catch (error) {
  try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (_) {}
  app.preferences.rulerUnits = previousRulerUnits;
  throw error;
}
"@
    try {
      [void]$photoshop.DoJavaScript($script)
      $results += [pscustomobject]@{
        id=$case.id; status='captured'; exposure=$case.exposure;
        offset=$case.offset; gamma=$case.gamma; file=$target; psd=$psdTarget
      }
    } catch {
      try { if ($photoshop.Documents.Count -gt 0) { $photoshop.ActiveDocument.Close(2) } } catch {}
      $results += [pscustomobject]@{
        id=$case.id; status='failed'; exposure=$case.exposure;
        offset=$case.offset; gamma=$case.gamma; error=$_.Exception.Message
      }
    }
  }
} finally {
  if ($null -ne $photoshop) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($photoshop) }
}

$manifest = Join-Path ([IO.Directory]::GetParent($outputPath).FullName) 'photoshop-manifest.json'
$results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifest -Encoding utf8
$results | Format-Table id,status,exposure,offset,gamma -AutoSize
$failures = @($results | Where-Object { $_.status -ne 'captured' })
if ($failures.Count) { throw "Photoshop adjustment oracle failed; see $manifest" }
Write-Host "Photoshop Exposure oracle: $manifest"
