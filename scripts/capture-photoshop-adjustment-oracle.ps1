param(
  [ValidateSet('exposure', 'brightness-contrast', 'levels')]
  [string]$Adjustment = 'exposure',
  [ValidateSet('validation', 'calibration')]
  [string]$Corpus = 'validation',
  [ValidateSet('untagged', 'srgb', 'adobe-rgb-1998')]
  [string]$Profile = 'untagged',
  [ValidateSet(8, 16)]
  [int]$BitDepth = 8,
  [string]$CasePattern = '',
  [string]$Source = 'D:\mediavibe\LightTableTests\ToneBrush\source\grayscale-ramp.png',
  [string]$Output = ''
)

$ErrorActionPreference = 'Stop'
$sourcePath = [IO.Path]::GetFullPath($Source)
if ([string]::IsNullOrWhiteSpace($Output)) {
  $corpusSuffix = if ($Corpus -eq 'calibration') { '\calibration' } else { '' }
  $Output = "D:\mediavibe\LightTableTests\AdjustmentParity\$Adjustment$corpusSuffix\photoshop"
}
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

$exposureCases = @(
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
$brightnessContrastCases = @(
  @{ id='neutral'; brightness=0; contrast=0; useLegacy=$false },
  @{ id='brightness-neg-150'; brightness=-150; contrast=0; useLegacy=$false },
  @{ id='brightness-neg-120'; brightness=-120; contrast=0; useLegacy=$false },
  @{ id='brightness-neg-30'; brightness=-30; contrast=0; useLegacy=$false },
  @{ id='brightness-neg-1'; brightness=-1; contrast=0; useLegacy=$false },
  @{ id='brightness-pos-1'; brightness=1; contrast=0; useLegacy=$false },
  @{ id='brightness-pos-30'; brightness=30; contrast=0; useLegacy=$false },
  @{ id='brightness-pos-120'; brightness=120; contrast=0; useLegacy=$false },
  @{ id='brightness-pos-150'; brightness=150; contrast=0; useLegacy=$false },
  @{ id='contrast-neg-50'; brightness=0; contrast=-50; useLegacy=$false },
  @{ id='contrast-neg-40'; brightness=0; contrast=-40; useLegacy=$false },
  @{ id='contrast-neg-20'; brightness=0; contrast=-20; useLegacy=$false },
  @{ id='contrast-neg-1'; brightness=0; contrast=-1; useLegacy=$false },
  @{ id='contrast-pos-1'; brightness=0; contrast=1; useLegacy=$false },
  @{ id='contrast-pos-20'; brightness=0; contrast=20; useLegacy=$false },
  @{ id='contrast-pos-80'; brightness=0; contrast=80; useLegacy=$false },
  @{ id='contrast-pos-100'; brightness=0; contrast=100; useLegacy=$false },
  @{ id='combined-positive-80'; brightness=120; contrast=80; useLegacy=$false },
  @{ id='combined-negative-80'; brightness=-120; contrast=-40; useLegacy=$false },
  @{ id='legacy-neutral'; brightness=0; contrast=0; useLegacy=$true },
  @{ id='legacy-brightness-neg-100'; brightness=-100; contrast=0; useLegacy=$true },
  @{ id='legacy-brightness-pos-100'; brightness=100; contrast=0; useLegacy=$true },
  @{ id='legacy-contrast-neg-100'; brightness=0; contrast=-100; useLegacy=$true },
  @{ id='legacy-contrast-pos-100'; brightness=0; contrast=100; useLegacy=$true },
  @{ id='legacy-combined-positive-80'; brightness=80; contrast=80; useLegacy=$true },
  @{ id='legacy-combined-negative-80'; brightness=-80; contrast=-80; useLegacy=$true }
)
$brightnessContrastCalibrationCases = @(
  @{ id='brightness-neg-150'; brightness=-150; contrast=0; useLegacy=$false },
  @{ id='brightness-neg-125'; brightness=-125; contrast=0; useLegacy=$false },
  @{ id='brightness-neg-100'; brightness=-100; contrast=0; useLegacy=$false },
  @{ id='brightness-neg-75'; brightness=-75; contrast=0; useLegacy=$false },
  @{ id='brightness-neg-50'; brightness=-50; contrast=0; useLegacy=$false },
  @{ id='brightness-neg-25'; brightness=-25; contrast=0; useLegacy=$false },
  @{ id='brightness-neutral'; brightness=0; contrast=0; useLegacy=$false },
  @{ id='brightness-pos-25'; brightness=25; contrast=0; useLegacy=$false },
  @{ id='brightness-pos-50'; brightness=50; contrast=0; useLegacy=$false },
  @{ id='brightness-pos-75'; brightness=75; contrast=0; useLegacy=$false },
  @{ id='brightness-pos-100'; brightness=100; contrast=0; useLegacy=$false },
  @{ id='brightness-pos-125'; brightness=125; contrast=0; useLegacy=$false },
  @{ id='brightness-pos-150'; brightness=150; contrast=0; useLegacy=$false },
  @{ id='contrast-neg-50'; brightness=0; contrast=-50; useLegacy=$false },
  @{ id='contrast-pos-100'; brightness=0; contrast=100; useLegacy=$false },
  @{ id='legacy-brightness-neg-80'; brightness=-80; contrast=0; useLegacy=$true },
  @{ id='legacy-brightness-pos-80'; brightness=80; contrast=0; useLegacy=$true },
  @{ id='legacy-contrast-neg-80'; brightness=0; contrast=-80; useLegacy=$true },
  @{ id='legacy-contrast-neg-50'; brightness=0; contrast=-50; useLegacy=$true },
  @{ id='legacy-contrast-neg-25'; brightness=0; contrast=-25; useLegacy=$true },
  @{ id='legacy-contrast-pos-25'; brightness=0; contrast=25; useLegacy=$true },
  @{ id='legacy-contrast-pos-50'; brightness=0; contrast=50; useLegacy=$true },
  @{ id='legacy-contrast-pos-80'; brightness=0; contrast=80; useLegacy=$true }
)
$levelsCases = @(
  @{ id='neutral'; channel='composite'; black=0; gamma=1.0; white=255; outputBlack=0; outputWhite=255 },
  @{ id='input-black-51'; channel='composite'; black=51; gamma=1.0; white=255; outputBlack=0; outputWhite=255 },
  @{ id='input-black-204'; channel='composite'; black=204; gamma=1.0; white=255; outputBlack=0; outputWhite=255 },
  @{ id='input-white-204'; channel='composite'; black=0; gamma=1.0; white=204; outputBlack=0; outputWhite=255 },
  @{ id='input-white-51'; channel='composite'; black=0; gamma=1.0; white=51; outputBlack=0; outputWhite=255 },
  @{ id='gamma-010'; channel='composite'; black=0; gamma=0.1; white=255; outputBlack=0; outputWhite=255 },
  @{ id='gamma-020'; channel='composite'; black=0; gamma=0.2; white=255; outputBlack=0; outputWhite=255 },
  @{ id='gamma-050'; channel='composite'; black=0; gamma=0.5; white=255; outputBlack=0; outputWhite=255 },
  @{ id='gamma-200'; channel='composite'; black=0; gamma=2.0; white=255; outputBlack=0; outputWhite=255 },
  @{ id='gamma-500'; channel='composite'; black=0; gamma=5.0; white=255; outputBlack=0; outputWhite=255 },
  @{ id='gamma-999'; channel='composite'; black=0; gamma=9.99; white=255; outputBlack=0; outputWhite=255 },
  @{ id='output-black-51'; channel='composite'; black=0; gamma=1.0; white=255; outputBlack=51; outputWhite=255 },
  @{ id='output-black-204'; channel='composite'; black=0; gamma=1.0; white=255; outputBlack=204; outputWhite=255 },
  @{ id='output-white-204'; channel='composite'; black=0; gamma=1.0; white=255; outputBlack=0; outputWhite=204 },
  @{ id='output-white-51'; channel='composite'; black=0; gamma=1.0; white=255; outputBlack=0; outputWhite=51 },
  @{ id='combined-80'; channel='composite'; black=40; gamma=0.2; white=215; outputBlack=40; outputWhite=215 },
  @{ id='red-combined'; channel='red'; black=30; gamma=2.0; white=220; outputBlack=20; outputWhite=235 },
  @{ id='green-combined'; channel='green'; black=30; gamma=2.0; white=220; outputBlack=20; outputWhite=235 },
  @{ id='blue-combined'; channel='blue'; black=30; gamma=2.0; white=220; outputBlack=20; outputWhite=235 },
  @{ id='composite-red-combined'; channel='composite'; black=20; gamma=0.5; white=235; outputBlack=10; outputWhite=245;
    secondaryChannel='red'; secondaryBlack=30; secondaryGamma=2.0; secondaryWhite=220; secondaryOutputBlack=20; secondaryOutputWhite=235 }
)
$cases = if ($Adjustment -eq 'brightness-contrast') {
  if ($Corpus -eq 'calibration') { $brightnessContrastCalibrationCases } else { $brightnessContrastCases }
} elseif ($Adjustment -eq 'levels') { $levelsCases } else { $exposureCases }
if (-not [string]::IsNullOrWhiteSpace($CasePattern)) {
  $cases = @($cases | Where-Object { $_.id -match $CasePattern })
  if ($cases.Count -eq 0) { throw "No adjustment oracle cases match: $CasePattern" }
}

$photoshop = $null
$results = @()
try {
  try { $photoshop = [Runtime.InteropServices.Marshal]::GetActiveObject('Photoshop.Application') }
  catch { $photoshop = New-Object -ComObject Photoshop.Application }
  $photoshop.DisplayDialogs = 3
  foreach ($case in $cases) {
    $target = Join-Path $outputPath "$($case.id).png"
    $psdTarget = Join-Path $psdPath "$($case.id).psd"
    if ($Adjustment -eq 'brightness-contrast') {
      $adjustmentDescriptor = @"
  var adjustment = new ActionDescriptor();
  adjustment.putInteger(s2t('brightness'), $($case.brightness));
  adjustment.putInteger(s2t('contrast'), $($case.contrast));
  adjustment.putBoolean(s2t('useLegacy'), $(if ($case.useLegacy) { 'true' } else { 'false' }));
  adjustmentLayer.putObject(s2t('type'), s2t('brightnessEvent'), adjustment);
"@
    } elseif ($Adjustment -eq 'levels') {
      $channelId = switch ($case.channel) {
        'red' { 'Rd  ' }
        'green' { 'Grn ' }
        'blue' { 'Bl  ' }
        default { 'Cmps' }
      }
      $secondaryDescriptor = ''
      if ($case.secondaryChannel) {
        $secondaryChannelId = switch ($case.secondaryChannel) {
          'red' { 'Rd  ' }
          'green' { 'Grn ' }
          'blue' { 'Bl  ' }
          default { 'Cmps' }
        }
        $secondaryDescriptor = "addLevelsChannel(levelsAdjustments, '$secondaryChannelId', $($case.secondaryBlack), $($case.secondaryGamma), $($case.secondaryWhite), $($case.secondaryOutputBlack), $($case.secondaryOutputWhite));"
      }
      $adjustmentDescriptor = @"
  var adjustment = new ActionDescriptor();
  adjustment.putEnumerated(s2t('presetKind'), s2t('presetKindType'), s2t('presetKindCustom'));
  function addLevelsChannel(list, channelId, black, gamma, white, outputBlack, outputWhite) {
    var levelChannel = new ActionDescriptor();
    var levelChannelReference = new ActionReference();
    levelChannelReference.putEnumerated(c2t('Chnl'), c2t('Chnl'), c2t(channelId));
    levelChannel.putReference(c2t('Chnl'), levelChannelReference);
    var levelInput = new ActionList();
    levelInput.putInteger(black); levelInput.putInteger(white);
    levelChannel.putList(c2t('Inpt'), levelInput);
    levelChannel.putDouble(c2t('Gmm '), gamma);
    var levelOutput = new ActionList();
    levelOutput.putInteger(outputBlack); levelOutput.putInteger(outputWhite);
    levelChannel.putList(c2t('Otpt'), levelOutput);
    list.putObject(c2t('LvlA'), levelChannel);
  }
  var levelsAdjustments = new ActionList();
  addLevelsChannel(levelsAdjustments, '$channelId', $($case.black), $($case.gamma), $($case.white), $($case.outputBlack), $($case.outputWhite));
  $secondaryDescriptor
  adjustment.putList(c2t('Adjs'), levelsAdjustments);
  adjustmentLayer.putObject(s2t('type'), s2t('levels'), adjustment);
"@
    } else {
      $adjustmentDescriptor = @"
  var adjustment = new ActionDescriptor();
  adjustment.putDouble(s2t('exposure'), $($case.exposure));
  adjustment.putDouble(s2t('offset'), $($case.offset));
  adjustment.putDouble(s2t('gammaCorrection'), $($case.gamma));
  adjustmentLayer.putObject(s2t('type'), s2t('exposure'), adjustment);
"@
    }
    $script = @"
var c2t = charIDToTypeID, s2t = stringIDToTypeID;
var previousRulerUnits = app.preferences.rulerUnits;
app.preferences.rulerUnits = Units.PIXELS;
var doc = app.open(new File($(JsString $sourcePath)));
try {
  $(if ($Profile -ne 'untagged') {
    "doc.convertProfile('sRGB IEC61966-2.1', Intent.RELATIVECOLORIMETRIC, true, false);"
  })
  $(if ($Profile -eq 'adobe-rgb-1998') {
    "doc.convertProfile('Adobe RGB (1998)', Intent.RELATIVECOLORIMETRIC, true, false);"
  })
  doc.bitsPerChannel = $(if ($BitDepth -eq 16) { 'BitsPerChannelType.SIXTEEN' } else { 'BitsPerChannelType.EIGHT' });
  var make = new ActionDescriptor();
  var adjustmentReference = new ActionReference();
  adjustmentReference.putClass(s2t('adjustmentLayer'));
  make.putReference(c2t('null'), adjustmentReference);
  var adjustmentLayer = new ActionDescriptor();
$adjustmentDescriptor
  make.putObject(s2t('using'), s2t('adjustmentLayer'), adjustmentLayer);
  executeAction(c2t('Mk  '), make, DialogModes.NO);

  var psd = new PhotoshopSaveOptions(); psd.layers = true; psd.maximizeCompatibility = true;
  psd.embedColorProfile = $(if ($Profile -ne 'untagged') { 'true' } else { 'false' });
  doc.saveAs(new File($(JsString $psdTarget)), psd, true, Extension.LOWERCASE);
  var png = new PNGSaveOptions(); png.interlaced = false;
  $(if ($Profile -ne 'untagged') {
    @"
  var rendered = doc.duplicate();
  rendered.flatten();
  rendered.convertProfile('sRGB IEC61966-2.1', Intent.RELATIVECOLORIMETRIC, true, false);
  rendered.saveAs(new File($(JsString $target)), png, true, Extension.LOWERCASE);
  rendered.close(SaveOptions.DONOTSAVECHANGES);
"@
  } else {
    "doc.saveAs(new File($(JsString $target)), png, true, Extension.LOWERCASE);"
  })
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
      $result = [ordered]@{ id=$case.id; adjustment=$Adjustment; profile=$Profile; bitDepth=$BitDepth; status='captured'; file=$target; psd=$psdTarget }
      foreach ($key in $case.Keys) { if ($key -ne 'id') { $result[$key] = $case[$key] } }
      $results += [pscustomobject]$result
    } catch {
      try { if ($photoshop.Documents.Count -gt 0) { $photoshop.ActiveDocument.Close(2) } } catch {}
      $result = [ordered]@{ id=$case.id; adjustment=$Adjustment; profile=$Profile; bitDepth=$BitDepth; status='failed'; error=$_.Exception.Message }
      foreach ($key in $case.Keys) { if ($key -ne 'id') { $result[$key] = $case[$key] } }
      $results += [pscustomobject]$result
    }
  }
} finally {
  if ($null -ne $photoshop) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($photoshop) }
}

$manifest = Join-Path ([IO.Directory]::GetParent($outputPath).FullName) 'photoshop-manifest.json'
ConvertTo-Json -InputObject @($results) -Depth 5 | Set-Content -LiteralPath $manifest -Encoding utf8
$results | Format-Table -AutoSize
$failures = @($results | Where-Object { $_.status -ne 'captured' })
if ($failures.Count) { throw "Photoshop adjustment oracle failed; see $manifest" }
Write-Host "Photoshop $Adjustment $Corpus oracle: $manifest"
