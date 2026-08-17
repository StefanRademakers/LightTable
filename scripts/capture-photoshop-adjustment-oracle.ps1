param(
  [ValidateSet('exposure', 'brightness-contrast', 'levels', 'curves', 'hue-saturation', 'vibrance', 'color-vibrance', 'color-balance', 'black-white', 'photo-filter', 'channel-mixer', 'selective-color', 'gradient-map', 'invert', 'posterize', 'threshold')]
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
$curvesCases = @(
  @{ id='neutral'; channel='composite'; points='0:0,255:255' },
  @{ id='lift-black-51'; channel='composite'; points='0:51,255:255' },
  @{ id='lift-black-204'; channel='composite'; points='0:204,255:255' },
  @{ id='lower-white-204'; channel='composite'; points='0:0,255:204' },
  @{ id='lower-white-51'; channel='composite'; points='0:0,255:51' },
  @{ id='midtone-up-80'; channel='composite'; points='0:0,128:230,255:255' },
  @{ id='midtone-down-80'; channel='composite'; points='0:0,128:26,255:255' },
  @{ id='s-curve'; channel='composite'; points='0:0,64:32,192:224,255:255' },
  @{ id='inverse'; channel='composite'; points='0:255,255:0' },
  @{ id='red-s-curve'; channel='red'; points='0:0,64:32,192:224,255:255' },
  @{ id='green-s-curve'; channel='green'; points='0:0,64:32,192:224,255:255' },
  @{ id='blue-s-curve'; channel='blue'; points='0:0,64:32,192:224,255:255' },
  @{ id='composite-red-stack'; channel='composite'; points='0:0,128:204,255:255'; secondaryChannel='red'; secondaryPoints='0:0,128:64,255:255' }
)
$hueSaturationCases = @(
  @{ id='neutral'; hue=0; saturation=0; lightness=0; colorize=$false },
  @{ id='hue-neg-180'; hue=-180; saturation=0; lightness=0; colorize=$false },
  @{ id='hue-neg-144'; hue=-144; saturation=0; lightness=0; colorize=$false },
  @{ id='hue-neg-36'; hue=-36; saturation=0; lightness=0; colorize=$false },
  @{ id='hue-pos-36'; hue=36; saturation=0; lightness=0; colorize=$false },
  @{ id='hue-pos-144'; hue=144; saturation=0; lightness=0; colorize=$false },
  @{ id='hue-pos-180'; hue=180; saturation=0; lightness=0; colorize=$false },
  @{ id='saturation-neg-100'; hue=0; saturation=-100; lightness=0; colorize=$false },
  @{ id='saturation-neg-80'; hue=0; saturation=-80; lightness=0; colorize=$false },
  @{ id='saturation-neg-20'; hue=0; saturation=-20; lightness=0; colorize=$false },
  @{ id='saturation-pos-20'; hue=0; saturation=20; lightness=0; colorize=$false },
  @{ id='saturation-pos-80'; hue=0; saturation=80; lightness=0; colorize=$false },
  @{ id='saturation-pos-100'; hue=0; saturation=100; lightness=0; colorize=$false },
  @{ id='lightness-neg-100'; hue=0; saturation=0; lightness=-100; colorize=$false },
  @{ id='lightness-neg-80'; hue=0; saturation=0; lightness=-80; colorize=$false },
  @{ id='lightness-neg-20'; hue=0; saturation=0; lightness=-20; colorize=$false },
  @{ id='lightness-pos-20'; hue=0; saturation=0; lightness=20; colorize=$false },
  @{ id='lightness-pos-80'; hue=0; saturation=0; lightness=80; colorize=$false },
  @{ id='lightness-pos-100'; hue=0; saturation=0; lightness=100; colorize=$false },
  @{ id='combined-positive-80'; hue=144; saturation=80; lightness=80; colorize=$false },
  @{ id='combined-negative-80'; hue=-144; saturation=-80; lightness=-80; colorize=$false },
  @{ id='colorize-80'; hue=288; saturation=80; lightness=0; colorize=$true },
  @{ id='range-red-combined-80'; hue=0; saturation=0; lightness=0; colorize=$false; rangeIndex=1; rangeHue=144; rangeSaturation=80; rangeLightness=80 },
  @{ id='range-red-hue-pos-80'; hue=0; saturation=0; lightness=0; colorize=$false; rangeIndex=1; rangeHue=144; rangeSaturation=0; rangeLightness=0 },
  @{ id='range-red-saturation-pos-80'; hue=0; saturation=0; lightness=0; colorize=$false; rangeIndex=1; rangeHue=0; rangeSaturation=80; rangeLightness=0 },
  @{ id='range-red-lightness-pos-80'; hue=0; saturation=0; lightness=0; colorize=$false; rangeIndex=1; rangeHue=0; rangeSaturation=0; rangeLightness=80 },
  @{ id='range-yellow-saturation-neg-100'; hue=0; saturation=0; lightness=0; colorize=$false; rangeIndex=2; rangeHue=0; rangeSaturation=-100; rangeLightness=0 },
  @{ id='range-green-lightness-pos-80'; hue=0; saturation=0; lightness=0; colorize=$false; rangeIndex=3; rangeHue=0; rangeSaturation=0; rangeLightness=80 },
  @{ id='range-cyan-hue-neg-80'; hue=0; saturation=0; lightness=0; colorize=$false; rangeIndex=4; rangeHue=-144; rangeSaturation=0; rangeLightness=0 },
  @{ id='range-blue-saturation-pos-100'; hue=0; saturation=0; lightness=0; colorize=$false; rangeIndex=5; rangeHue=0; rangeSaturation=100; rangeLightness=0 },
  @{ id='range-magenta-lightness-neg-80'; hue=0; saturation=0; lightness=0; colorize=$false; rangeIndex=6; rangeHue=0; rangeSaturation=0; rangeLightness=-80 }
)
$colorBalanceCases = @(
  @{ id='neutral'; shadows=@(0,0,0); midtones=@(0,0,0); highlights=@(0,0,0); preserveLuminosity=$true },
  @{ id='shadows-cyan-red-neg-100'; shadows=@(-100,0,0); midtones=@(0,0,0); highlights=@(0,0,0); preserveLuminosity=$true },
  @{ id='shadows-cyan-red-pos-100'; shadows=@(100,0,0); midtones=@(0,0,0); highlights=@(0,0,0); preserveLuminosity=$true },
  @{ id='shadows-magenta-green-neg-80'; shadows=@(0,-80,0); midtones=@(0,0,0); highlights=@(0,0,0); preserveLuminosity=$true },
  @{ id='shadows-yellow-blue-pos-80'; shadows=@(0,0,80); midtones=@(0,0,0); highlights=@(0,0,0); preserveLuminosity=$true },
  @{ id='shadows-combined-80'; shadows=@(80,-80,80); midtones=@(0,0,0); highlights=@(0,0,0); preserveLuminosity=$true },
  @{ id='midtones-cyan-red-neg-100'; shadows=@(0,0,0); midtones=@(-100,0,0); highlights=@(0,0,0); preserveLuminosity=$true },
  @{ id='midtones-cyan-red-pos-100'; shadows=@(0,0,0); midtones=@(100,0,0); highlights=@(0,0,0); preserveLuminosity=$true },
  @{ id='midtones-magenta-green-neg-80'; shadows=@(0,0,0); midtones=@(0,-80,0); highlights=@(0,0,0); preserveLuminosity=$true },
  @{ id='midtones-yellow-blue-pos-80'; shadows=@(0,0,0); midtones=@(0,0,80); highlights=@(0,0,0); preserveLuminosity=$true },
  @{ id='midtones-combined-80'; shadows=@(0,0,0); midtones=@(80,-80,80); highlights=@(0,0,0); preserveLuminosity=$true },
  @{ id='highlights-cyan-red-neg-100'; shadows=@(0,0,0); midtones=@(0,0,0); highlights=@(-100,0,0); preserveLuminosity=$true },
  @{ id='highlights-cyan-red-pos-100'; shadows=@(0,0,0); midtones=@(0,0,0); highlights=@(100,0,0); preserveLuminosity=$true },
  @{ id='highlights-magenta-green-neg-80'; shadows=@(0,0,0); midtones=@(0,0,0); highlights=@(0,-80,0); preserveLuminosity=$true },
  @{ id='highlights-yellow-blue-pos-80'; shadows=@(0,0,0); midtones=@(0,0,0); highlights=@(0,0,80); preserveLuminosity=$true },
  @{ id='highlights-combined-80'; shadows=@(0,0,0); midtones=@(0,0,0); highlights=@(80,-80,80); preserveLuminosity=$true },
  @{ id='all-tones-combined-80'; shadows=@(-80,80,-80); midtones=@(80,-80,80); highlights=@(-80,80,-80); preserveLuminosity=$true },
  @{ id='shadows-cyan-red-neg-100-no-preserve'; shadows=@(-100,0,0); midtones=@(0,0,0); highlights=@(0,0,0); preserveLuminosity=$false },
  @{ id='shadows-cyan-red-pos-100-no-preserve'; shadows=@(100,0,0); midtones=@(0,0,0); highlights=@(0,0,0); preserveLuminosity=$false },
  @{ id='shadows-cyan-red-neg-20-no-preserve'; shadows=@(-20,0,0); midtones=@(0,0,0); highlights=@(0,0,0); preserveLuminosity=$false },
  @{ id='shadows-cyan-red-pos-20-no-preserve'; shadows=@(20,0,0); midtones=@(0,0,0); highlights=@(0,0,0); preserveLuminosity=$false },
  @{ id='shadows-cyan-red-neg-80-no-preserve'; shadows=@(-80,0,0); midtones=@(0,0,0); highlights=@(0,0,0); preserveLuminosity=$false },
  @{ id='shadows-cyan-red-pos-80-no-preserve'; shadows=@(80,0,0); midtones=@(0,0,0); highlights=@(0,0,0); preserveLuminosity=$false },
  @{ id='midtones-cyan-red-neg-100-no-preserve'; shadows=@(0,0,0); midtones=@(-100,0,0); highlights=@(0,0,0); preserveLuminosity=$false },
  @{ id='midtones-cyan-red-pos-100-no-preserve'; shadows=@(0,0,0); midtones=@(100,0,0); highlights=@(0,0,0); preserveLuminosity=$false },
  @{ id='midtones-cyan-red-neg-20-no-preserve'; shadows=@(0,0,0); midtones=@(-20,0,0); highlights=@(0,0,0); preserveLuminosity=$false },
  @{ id='midtones-cyan-red-pos-20-no-preserve'; shadows=@(0,0,0); midtones=@(20,0,0); highlights=@(0,0,0); preserveLuminosity=$false },
  @{ id='midtones-cyan-red-neg-80-no-preserve'; shadows=@(0,0,0); midtones=@(-80,0,0); highlights=@(0,0,0); preserveLuminosity=$false },
  @{ id='midtones-cyan-red-pos-80-no-preserve'; shadows=@(0,0,0); midtones=@(80,0,0); highlights=@(0,0,0); preserveLuminosity=$false },
  @{ id='highlights-cyan-red-neg-100-no-preserve'; shadows=@(0,0,0); midtones=@(0,0,0); highlights=@(-100,0,0); preserveLuminosity=$false },
  @{ id='highlights-cyan-red-pos-100-no-preserve'; shadows=@(0,0,0); midtones=@(0,0,0); highlights=@(100,0,0); preserveLuminosity=$false },
  @{ id='highlights-cyan-red-neg-20-no-preserve'; shadows=@(0,0,0); midtones=@(0,0,0); highlights=@(-20,0,0); preserveLuminosity=$false },
  @{ id='highlights-cyan-red-pos-20-no-preserve'; shadows=@(0,0,0); midtones=@(0,0,0); highlights=@(20,0,0); preserveLuminosity=$false },
  @{ id='highlights-cyan-red-neg-80-no-preserve'; shadows=@(0,0,0); midtones=@(0,0,0); highlights=@(-80,0,0); preserveLuminosity=$false },
  @{ id='highlights-cyan-red-pos-80-no-preserve'; shadows=@(0,0,0); midtones=@(0,0,0); highlights=@(80,0,0); preserveLuminosity=$false },
  @{ id='midtones-combined-no-preserve'; shadows=@(0,0,0); midtones=@(80,-80,80); highlights=@(0,0,0); preserveLuminosity=$false },
  @{ id='all-tones-no-preserve'; shadows=@(-80,80,-80); midtones=@(80,-80,80); highlights=@(-80,80,-80); preserveLuminosity=$false }
)
$colorBalanceCalibrationCases = @()
foreach ($tone in @('shadows', 'midtones', 'highlights')) {
  foreach ($amount in (-100..100 | Where-Object { $_ % 10 -eq 0 })) {
    $settings = @{
      id="transfer-$tone-$amount"
      shadows=@(0,0,0)
      midtones=@(0,0,0)
      highlights=@(0,0,0)
      preserveLuminosity=$false
    }
    $settings[$tone] = @($amount,0,0)
    $colorBalanceCalibrationCases += $settings
  }
}
$photoFilterCases = @(
  @{ id='warm-density-1-preserve'; color=@(255,140,40); density=1; preserveLuminosity=$true },
  @{ id='warm-density-20-preserve'; color=@(255,140,40); density=20; preserveLuminosity=$true },
  @{ id='warm-density-50-preserve'; color=@(255,140,40); density=50; preserveLuminosity=$true },
  @{ id='warm-density-80-preserve'; color=@(255,140,40); density=80; preserveLuminosity=$true },
  @{ id='warm-density-100-preserve'; color=@(255,140,40); density=100; preserveLuminosity=$true },
  @{ id='warm-density-20-no-preserve'; color=@(255,140,40); density=20; preserveLuminosity=$false },
  @{ id='warm-density-1-no-preserve'; color=@(255,140,40); density=1; preserveLuminosity=$false },
  @{ id='warm-density-50-no-preserve'; color=@(255,140,40); density=50; preserveLuminosity=$false },
  @{ id='warm-density-80-no-preserve'; color=@(255,140,40); density=80; preserveLuminosity=$false },
  @{ id='warm-density-100-no-preserve'; color=@(255,140,40); density=100; preserveLuminosity=$false },
  @{ id='red-density-20-preserve'; color=@(255,0,0); density=20; preserveLuminosity=$true },
  @{ id='red-density-80-preserve'; color=@(255,0,0); density=80; preserveLuminosity=$true },
  @{ id='red-density-20-no-preserve'; color=@(255,0,0); density=20; preserveLuminosity=$false },
  @{ id='red-density-80-no-preserve'; color=@(255,0,0); density=80; preserveLuminosity=$false },
  @{ id='red-density-100-no-preserve'; color=@(255,0,0); density=100; preserveLuminosity=$false },
  @{ id='blue-density-20-preserve'; color=@(0,80,255); density=20; preserveLuminosity=$true },
  @{ id='blue-density-80-preserve'; color=@(0,80,255); density=80; preserveLuminosity=$true },
  @{ id='blue-density-20-no-preserve'; color=@(0,80,255); density=20; preserveLuminosity=$false },
  @{ id='blue-density-80-no-preserve'; color=@(0,80,255); density=80; preserveLuminosity=$false },
  @{ id='blue-density-100-no-preserve'; color=@(0,80,255); density=100; preserveLuminosity=$false },
  @{ id='green-density-100-preserve'; color=@(0,255,80); density=100; preserveLuminosity=$true },
  @{ id='green-density-100-no-preserve'; color=@(0,255,80); density=100; preserveLuminosity=$false },
  @{ id='gray-density-80-preserve'; color=@(128,128,128); density=80; preserveLuminosity=$true },
  @{ id='gray-density-80-no-preserve'; color=@(128,128,128); density=80; preserveLuminosity=$false },
  @{ id='white-density-100-preserve'; color=@(255,255,255); density=100; preserveLuminosity=$true },
  @{ id='white-density-100-no-preserve'; color=@(255,255,255); density=100; preserveLuminosity=$false },
  @{ id='black-density-100-preserve'; color=@(0,0,0); density=100; preserveLuminosity=$true },
  @{ id='black-density-100-no-preserve'; color=@(0,0,0); density=100; preserveLuminosity=$false }
)
$blackWhiteCases = @(
  @{ id='default'; mix=@(40,60,40,60,20,80); tint=$false; tintColor=@(225,211,179) },
  @{ id='all-zero'; mix=@(0,0,0,0,0,0); tint=$false; tintColor=@(225,211,179) },
  @{ id='all-100'; mix=@(100,100,100,100,100,100); tint=$false; tintColor=@(225,211,179) },
  @{ id='all-neg-200'; mix=@(-200,-200,-200,-200,-200,-200); tint=$false; tintColor=@(225,211,179) },
  @{ id='all-pos-300'; mix=@(300,300,300,300,300,300); tint=$false; tintColor=@(225,211,179) },
  @{ id='alternating-extremes'; mix=@(-200,300,-200,300,-200,300); tint=$false; tintColor=@(225,211,179) },
  @{ id='reds-neg-200'; mix=@(-200,60,40,60,20,80); tint=$false; tintColor=@(225,211,179) },
  @{ id='reds-pos-100'; mix=@(100,60,40,60,20,80); tint=$false; tintColor=@(225,211,179) },
  @{ id='reds-pos-300'; mix=@(300,60,40,60,20,80); tint=$false; tintColor=@(225,211,179) },
  @{ id='yellows-neg-200'; mix=@(40,-200,40,60,20,80); tint=$false; tintColor=@(225,211,179) },
  @{ id='yellows-pos-300'; mix=@(40,300,40,60,20,80); tint=$false; tintColor=@(225,211,179) },
  @{ id='greens-neg-200'; mix=@(40,60,-200,60,20,80); tint=$false; tintColor=@(225,211,179) },
  @{ id='greens-pos-300'; mix=@(40,60,300,60,20,80); tint=$false; tintColor=@(225,211,179) },
  @{ id='cyans-neg-200'; mix=@(40,60,40,-200,20,80); tint=$false; tintColor=@(225,211,179) },
  @{ id='cyans-pos-300'; mix=@(40,60,40,300,20,80); tint=$false; tintColor=@(225,211,179) },
  @{ id='blues-neg-200'; mix=@(40,60,40,60,-200,80); tint=$false; tintColor=@(225,211,179) },
  @{ id='blues-pos-300'; mix=@(40,60,40,60,300,80); tint=$false; tintColor=@(225,211,179) },
  @{ id='magentas-neg-200'; mix=@(40,60,40,60,20,-200); tint=$false; tintColor=@(225,211,179) },
  @{ id='magentas-pos-300'; mix=@(40,60,40,60,20,300); tint=$false; tintColor=@(225,211,179) },
  @{ id='default-tint'; mix=@(40,60,40,60,20,80); tint=$true; tintColor=@(225,211,179) },
  @{ id='red-tint'; mix=@(40,60,40,60,20,80); tint=$true; tintColor=@(255,0,0) },
  @{ id='blue-tint'; mix=@(40,60,40,60,20,80); tint=$true; tintColor=@(0,80,255) }
)
$channelMixerCases = @(
  @{ id='identity'; monochrome=$false; red=@(100,0,0,0); green=@(0,100,0,0); blue=@(0,0,100,0); gray=@(40,40,20,0) },
  @{ id='swap-red-blue'; monochrome=$false; red=@(0,0,100,0); green=@(0,100,0,0); blue=@(100,0,0,0); gray=@(40,40,20,0) },
  @{ id='red-source-neg-200'; monochrome=$false; red=@(-200,0,0,0); green=@(0,100,0,0); blue=@(0,0,100,0); gray=@(40,40,20,0) },
  @{ id='red-source-pos-200'; monochrome=$false; red=@(200,0,0,0); green=@(0,100,0,0); blue=@(0,0,100,0); gray=@(40,40,20,0) },
  @{ id='red-combined'; monochrome=$false; red=@(-70,200,-30,0); green=@(0,100,0,0); blue=@(0,0,100,0); gray=@(40,40,20,0) },
  @{ id='full-matrix'; monochrome=$false; red=@(80,40,-20,10); green=@(-50,200,-50,-20); blue=@(25,25,100,30); gray=@(40,40,20,0) },
  @{ id='red-constant-neg-200'; monochrome=$false; red=@(100,0,0,-200); green=@(0,100,0,0); blue=@(0,0,100,0); gray=@(40,40,20,0) },
  @{ id='red-constant-pos-200'; monochrome=$false; red=@(100,0,0,200); green=@(0,100,0,0); blue=@(0,0,100,0); gray=@(40,40,20,0) },
  @{ id='all-constant-pos-80'; monochrome=$false; red=@(100,0,0,80); green=@(0,100,0,80); blue=@(0,0,100,80); gray=@(40,40,20,0) },
  @{ id='monochrome-default'; monochrome=$true; red=@(100,0,0,0); green=@(0,100,0,0); blue=@(0,0,100,0); gray=@(40,40,20,0) },
  @{ id='monochrome-red'; monochrome=$true; red=@(100,0,0,0); green=@(0,100,0,0); blue=@(0,0,100,0); gray=@(100,0,0,0) },
  @{ id='monochrome-infrared'; monochrome=$true; red=@(100,0,0,0); green=@(0,100,0,0); blue=@(0,0,100,0); gray=@(-70,200,-30,0) },
  @{ id='monochrome-extreme'; monochrome=$true; red=@(100,0,0,0); green=@(0,100,0,0); blue=@(0,0,100,0); gray=@(-200,200,200,-80) },
  @{ id='monochrome-constant-neg-200'; monochrome=$true; red=@(100,0,0,0); green=@(0,100,0,0); blue=@(0,0,100,0); gray=@(40,40,20,-200) },
  @{ id='monochrome-constant-pos-200'; monochrome=$true; red=@(100,0,0,0); green=@(0,100,0,0); blue=@(0,0,100,0); gray=@(40,40,20,200) }
)
$invertCases = @(@{ id='invert' })
$posterizeCases = @(2,3,4,8,16,32,64,128,255) | ForEach-Object {
  @{ id="levels-$_"; levels=$_ }
}
$thresholdCases = @(1,2,64,127,128,192,254,255) | ForEach-Object {
  @{ id="level-$_"; level=$_ }
}
$vibranceCases = @(
  @{ id='neutral'; vibrance=0; saturation=0 },
  @{ id='vibrance-neg-100'; vibrance=-100; saturation=0 },
  @{ id='vibrance-neg-80'; vibrance=-80; saturation=0 },
  @{ id='vibrance-neg-20'; vibrance=-20; saturation=0 },
  @{ id='vibrance-pos-20'; vibrance=20; saturation=0 },
  @{ id='vibrance-pos-80'; vibrance=80; saturation=0 },
  @{ id='vibrance-pos-100'; vibrance=100; saturation=0 },
  @{ id='saturation-neg-100'; vibrance=0; saturation=-100 },
  @{ id='saturation-neg-80'; vibrance=0; saturation=-80 },
  @{ id='saturation-neg-20'; vibrance=0; saturation=-20 },
  @{ id='saturation-pos-20'; vibrance=0; saturation=20 },
  @{ id='saturation-pos-80'; vibrance=0; saturation=80 },
  @{ id='saturation-pos-100'; vibrance=0; saturation=100 },
  @{ id='combined-positive-80'; vibrance=80; saturation=80 },
  @{ id='combined-negative-80'; vibrance=-80; saturation=-80 }
)
$colorVibranceCases = @(
  @{ id='neutral'; temperature=0; tint=0; vibrance=0; saturation=0 },
  @{ id='temperature-neg-100'; temperature=-100; tint=0; vibrance=0; saturation=0 },
  @{ id='temperature-neg-80'; temperature=-80; tint=0; vibrance=0; saturation=0 },
  @{ id='temperature-neg-20'; temperature=-20; tint=0; vibrance=0; saturation=0 },
  @{ id='temperature-pos-20'; temperature=20; tint=0; vibrance=0; saturation=0 },
  @{ id='temperature-pos-80'; temperature=80; tint=0; vibrance=0; saturation=0 },
  @{ id='temperature-pos-100'; temperature=100; tint=0; vibrance=0; saturation=0 },
  @{ id='tint-neg-100'; temperature=0; tint=-100; vibrance=0; saturation=0 },
  @{ id='tint-neg-80'; temperature=0; tint=-80; vibrance=0; saturation=0 },
  @{ id='tint-neg-20'; temperature=0; tint=-20; vibrance=0; saturation=0 },
  @{ id='tint-pos-20'; temperature=0; tint=20; vibrance=0; saturation=0 },
  @{ id='tint-pos-80'; temperature=0; tint=80; vibrance=0; saturation=0 },
  @{ id='tint-pos-100'; temperature=0; tint=100; vibrance=0; saturation=0 },
  @{ id='vibrance-neg-100'; temperature=0; tint=0; vibrance=-100; saturation=0 },
  @{ id='vibrance-neg-80'; temperature=0; tint=0; vibrance=-80; saturation=0 },
  @{ id='vibrance-neg-20'; temperature=0; tint=0; vibrance=-20; saturation=0 },
  @{ id='vibrance-pos-20'; temperature=0; tint=0; vibrance=20; saturation=0 },
  @{ id='vibrance-pos-80'; temperature=0; tint=0; vibrance=80; saturation=0 },
  @{ id='vibrance-pos-100'; temperature=0; tint=0; vibrance=100; saturation=0 },
  @{ id='saturation-neg-100'; temperature=0; tint=0; vibrance=0; saturation=-100 },
  @{ id='saturation-neg-80'; temperature=0; tint=0; vibrance=0; saturation=-80 },
  @{ id='saturation-neg-20'; temperature=0; tint=0; vibrance=0; saturation=-20 },
  @{ id='saturation-pos-20'; temperature=0; tint=0; vibrance=0; saturation=20 },
  @{ id='saturation-pos-80'; temperature=0; tint=0; vibrance=0; saturation=80 },
  @{ id='saturation-pos-100'; temperature=0; tint=0; vibrance=0; saturation=100 },
  @{ id='combined-positive-80'; temperature=80; tint=80; vibrance=80; saturation=80 },
  @{ id='combined-negative-80'; temperature=-80; tint=-80; vibrance=-80; saturation=-80 },
  @{ id='heldout-wb-positive-50'; temperature=50; tint=50; vibrance=0; saturation=0 },
  @{ id='heldout-wb-cross-50'; temperature=50; tint=-50; vibrance=0; saturation=0 },
  @{ id='heldout-wb-negative-50'; temperature=-50; tint=-50; vibrance=0; saturation=0 },
  @{ id='heldout-color-positive-50'; temperature=0; tint=0; vibrance=50; saturation=50 },
  @{ id='heldout-color-cross-50'; temperature=0; tint=0; vibrance=50; saturation=-50 },
  @{ id='heldout-color-negative-50'; temperature=0; tint=0; vibrance=-50; saturation=-50 },
  @{ id='heldout-combined-positive-50'; temperature=50; tint=50; vibrance=50; saturation=50 },
  @{ id='heldout-combined-cross-50'; temperature=50; tint=-50; vibrance=50; saturation=-50 },
  @{ id='heldout-combined-negative-50'; temperature=-50; tint=-50; vibrance=-50; saturation=-50 },
  @{ id='heldout-combined-random-a'; temperature=33; tint=-67; vibrance=72; saturation=41 },
  @{ id='heldout-combined-random-b'; temperature=-91; tint=37; vibrance=-44; saturation=63 },
  @{ id='heldout-wb-random-b'; temperature=-91; tint=37; vibrance=0; saturation=0 },
  @{ id='heldout-color-random-b'; temperature=0; tint=0; vibrance=-44; saturation=63 }
)
$colorVibranceCalibrationCases = @($colorVibranceCases)
$colorVibranceParameters = @('temperature', 'tint', 'vibrance', 'saturation')
for ($firstIndex = 0; $firstIndex -lt $colorVibranceParameters.Count; $firstIndex++) {
  for ($secondIndex = $firstIndex + 1; $secondIndex -lt $colorVibranceParameters.Count; $secondIndex++) {
    $first = $colorVibranceParameters[$firstIndex]
    $second = $colorVibranceParameters[$secondIndex]
    foreach ($firstValue in @(-80, 80)) {
      foreach ($secondValue in @(-80, 80)) {
        $entry = @{
          id="pair-$first-$firstValue-$second-$secondValue"
          temperature=0
          tint=0
          vibrance=0
          saturation=0
        }
        $entry[$first] = $firstValue
        $entry[$second] = $secondValue
        $colorVibranceCalibrationCases += $entry
      }
    }
  }
}
$colorVibranceKnots = @(-100, -80, -20, 0, 20, 80, 100)
foreach ($temperature in $colorVibranceKnots) {
  foreach ($tint in $colorVibranceKnots) {
    $colorVibranceCalibrationCases += @{
      id="wb-temperature-$temperature-tint-$tint"
      temperature=$temperature
      tint=$tint
      vibrance=0
      saturation=0
    }
  }
}
foreach ($temperature in (-100..100 | Where-Object { $_ % 10 -eq 0 })) {
  foreach ($tint in (-100..100 | Where-Object { $_ % 10 -eq 0 })) {
    $colorVibranceCalibrationCases += @{
      id="wb10-temperature-$temperature-tint-$tint"
      temperature=$temperature
      tint=$tint
      vibrance=0
      saturation=0
    }
  }
}
foreach ($vibrance in $colorVibranceKnots) {
  foreach ($saturation in $colorVibranceKnots) {
    $colorVibranceCalibrationCases += @{
      id="color-vibrance-$vibrance-saturation-$saturation"
      temperature=0
      tint=0
      vibrance=$vibrance
      saturation=$saturation
    }
  }
}
$selectiveColorCases = @(@{ id='neutral'; rangeIndex=0; cmyk=@(0,0,0,0); method='relative' })
$selectiveRangeNames = @('reds','yellows','greens','cyans','blues','magentas','whites','neutrals','blacks')
for ($rangeIndex = 0; $rangeIndex -lt $selectiveRangeNames.Count; $rangeIndex++) {
  $rangeName = $selectiveRangeNames[$rangeIndex]
  $selectiveColorCases += @(
    @{ id="$rangeName-relative-cyan-pos-100"; rangeIndex=$rangeIndex; cmyk=@(100,0,0,0); method='relative' },
    @{ id="$rangeName-relative-black-neg-100"; rangeIndex=$rangeIndex; cmyk=@(0,0,0,-100); method='relative' },
    @{ id="$rangeName-relative-black-pos-100"; rangeIndex=$rangeIndex; cmyk=@(0,0,0,100); method='relative' },
    @{ id="$rangeName-absolute-mix"; rangeIndex=$rangeIndex; cmyk=@(80,-60,40,100); method='absolute' }
  )
}
$blackStop = @{ location=0; midpoint=50; color=@(0,0,0) }
$whiteStop = @{ location=4096; midpoint=50; color=@(255,255,255) }
$opaqueStops = @(
  @{ location=0; midpoint=50; opacity=100 },
  @{ location=4096; midpoint=50; opacity=100 }
)
$gradientMapCases = @(
  @{ id='black-white'; reverse=$false; dither=$false; colorStops=@($blackStop,$whiteStop); opacityStops=$opaqueStops },
  @{ id='black-white-reverse'; reverse=$true; dither=$false; colorStops=@($blackStop,$whiteStop); opacityStops=$opaqueStops },
  @{ id='black-white-midpoint-20'; reverse=$false; dither=$false; colorStops=@($blackStop,@{ location=4096; midpoint=20; color=@(255,255,255) }); opacityStops=$opaqueStops },
  @{ id='black-white-midpoint-80'; reverse=$false; dither=$false; colorStops=@($blackStop,@{ location=4096; midpoint=80; color=@(255,255,255) }); opacityStops=$opaqueStops },
  @{ id='red-blue'; reverse=$false; dither=$false; colorStops=@(@{ location=0; midpoint=50; color=@(255,0,0) },@{ location=4096; midpoint=50; color=@(0,0,255) }); opacityStops=$opaqueStops },
  @{ id='blue-orange-opaque'; reverse=$false; dither=$false; colorStops=@(@{ location=0; midpoint=50; color=@(0,64,255) },@{ location=4096; midpoint=50; color=@(255,128,0) }); opacityStops=$opaqueStops },
  @{ id='three-stop-extreme'; reverse=$false; dither=$false; colorStops=@(@{ location=0; midpoint=20; color=@(0,0,255) },@{ location=1024; midpoint=80; color=@(255,0,0) },@{ location=4096; midpoint=50; color=@(255,255,255) }); opacityStops=$opaqueStops },
  @{ id='opacity-left-zero'; reverse=$false; dither=$false; colorStops=@($blackStop,$whiteStop); opacityStops=@(@{ location=0; midpoint=50; opacity=0 },@{ location=4096; midpoint=50; opacity=100 }) },
  @{ id='opacity-three-stop'; reverse=$false; dither=$false; colorStops=@(@{ location=0; midpoint=50; color=@(0,64,255) },@{ location=4096; midpoint=50; color=@(255,128,0) }); opacityStops=@(@{ location=0; midpoint=20; opacity=100 },@{ location=2048; midpoint=80; opacity=0 },@{ location=4096; midpoint=50; opacity=100 }) }
)
$cases = if ($Adjustment -eq 'brightness-contrast') {
  if ($Corpus -eq 'calibration') { $brightnessContrastCalibrationCases } else { $brightnessContrastCases }
} elseif ($Adjustment -eq 'levels') { $levelsCases }
elseif ($Adjustment -eq 'curves') { $curvesCases }
elseif ($Adjustment -eq 'hue-saturation') { $hueSaturationCases }
elseif ($Adjustment -eq 'vibrance') { $vibranceCases }
elseif ($Adjustment -eq 'color-vibrance') {
  if ($Corpus -eq 'calibration') { $colorVibranceCalibrationCases } else { $colorVibranceCases }
}
elseif ($Adjustment -eq 'color-balance') {
  if ($Corpus -eq 'calibration') { $colorBalanceCalibrationCases } else { $colorBalanceCases }
}
elseif ($Adjustment -eq 'black-white') { $blackWhiteCases }
elseif ($Adjustment -eq 'photo-filter') { $photoFilterCases }
elseif ($Adjustment -eq 'channel-mixer') { $channelMixerCases }
elseif ($Adjustment -eq 'selective-color') { $selectiveColorCases }
elseif ($Adjustment -eq 'gradient-map') { $gradientMapCases }
elseif ($Adjustment -eq 'invert') { $invertCases }
elseif ($Adjustment -eq 'posterize') { $posterizeCases }
elseif ($Adjustment -eq 'threshold') { $thresholdCases }
else { $exposureCases }
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
  while ($photoshop.Documents.Count -gt 0) {
    $photoshop.ActiveDocument.Close(2)
  }
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
    } elseif ($Adjustment -eq 'curves') {
      $channelId = switch ($case.channel) {
        'red' { 'Rd  ' }
        'green' { 'Grn ' }
        'blue' { 'Bl  ' }
        default { 'Cmps' }
      }
      $pointCalls = (($case.points -split ',') | ForEach-Object {
        $coordinates = $_ -split ':'
        "addCurvePoint(curvePoints, $($coordinates[0]), $($coordinates[1]));"
      }) -join "`n  "
      $secondaryCurveDescriptor = ''
      if ($case.secondaryChannel) {
        $secondaryChannelId = switch ($case.secondaryChannel) {
          'red' { 'Rd  ' }
          'green' { 'Grn ' }
          'blue' { 'Bl  ' }
          default { 'Cmps' }
        }
        $secondaryPointCalls = (($case.secondaryPoints -split ',') | ForEach-Object {
          $coordinates = $_ -split ':'
          "addCurvePoint(secondaryCurvePoints, $($coordinates[0]), $($coordinates[1]));"
        }) -join "`n  "
        $secondaryCurveDescriptor = @"
  var secondaryCurvePoints = new ActionList();
  $secondaryPointCalls
  addCurveChannel(curveAdjustments, '$secondaryChannelId', secondaryCurvePoints);
"@
      }
      $adjustmentDescriptor = @"
  var adjustment = new ActionDescriptor();
  adjustment.putEnumerated(s2t('presetKind'), s2t('presetKindType'), s2t('presetKindCustom'));
  function addCurvePoint(list, horizontal, vertical) {
    var point = new ActionDescriptor();
    point.putDouble(c2t('Hrzn'), horizontal); point.putDouble(c2t('Vrtc'), vertical);
    list.putObject(c2t('Pnt '), point);
  }
  function addCurveChannel(list, channelId, points) {
    var curveChannel = new ActionDescriptor();
    var curveChannelReference = new ActionReference();
    curveChannelReference.putEnumerated(c2t('Chnl'), c2t('Chnl'), c2t(channelId));
    curveChannel.putReference(c2t('Chnl'), curveChannelReference);
    curveChannel.putList(c2t('Crv '), points);
    list.putObject(c2t('CrvA'), curveChannel);
  }
  var curveAdjustments = new ActionList();
  var curvePoints = new ActionList();
  $pointCalls
  addCurveChannel(curveAdjustments, '$channelId', curvePoints);
  $secondaryCurveDescriptor
  adjustment.putList(c2t('Adjs'), curveAdjustments);
  adjustmentLayer.putObject(s2t('type'), s2t('curves'), adjustment);
"@
    } elseif ($Adjustment -eq 'hue-saturation') {
      $rangeDescriptors = ''
      if ($case.ContainsKey('rangeIndex')) {
        $rangeBoundaries = @(
          @(315, 345, 15, 45),
          @(15, 45, 75, 105),
          @(75, 105, 135, 165),
          @(135, 165, 195, 225),
          @(195, 225, 255, 285),
          @(255, 285, 315, 345)
        )[$case.rangeIndex - 1]
        $rangeDescriptors = @"
  var rangeHue = new ActionDescriptor();
  rangeHue.putInteger(c2t('LclR'), $($case.rangeIndex));
  rangeHue.putInteger(c2t('BgnR'), $($rangeBoundaries[0]));
  rangeHue.putInteger(c2t('BgnS'), $($rangeBoundaries[1]));
  rangeHue.putInteger(c2t('EndS'), $($rangeBoundaries[2]));
  rangeHue.putInteger(c2t('EndR'), $($rangeBoundaries[3]));
  rangeHue.putInteger(c2t('H   '), $($case.rangeHue));
  rangeHue.putInteger(c2t('Strt'), $($case.rangeSaturation));
  rangeHue.putInteger(c2t('Lght'), $($case.rangeLightness));
  hueAdjustments.putObject(c2t('Hst2'), rangeHue);
"@
      }
      $adjustmentDescriptor = @"
  var adjustment = new ActionDescriptor();
  adjustment.putEnumerated(s2t('presetKind'), s2t('presetKindType'), s2t('presetKindCustom'));
  adjustment.putBoolean(c2t('Clrz'), $(if ($case.colorize) { 'true' } else { 'false' }));
  var hueAdjustments = new ActionList();
  var masterHue = new ActionDescriptor();
  masterHue.putInteger(c2t('H   '), $($case.hue));
  masterHue.putInteger(c2t('Strt'), $($case.saturation));
  masterHue.putInteger(c2t('Lght'), $($case.lightness));
  hueAdjustments.putObject(c2t('Hst2'), masterHue);
$rangeDescriptors
  adjustment.putList(c2t('Adjs'), hueAdjustments);
  adjustmentLayer.putObject(s2t('type'), s2t('hueSaturation'), adjustment);
"@
    } elseif ($Adjustment -eq 'vibrance') {
      $adjustmentDescriptor = @"
  var adjustment = new ActionDescriptor();
  adjustment.putInteger(s2t('vibrance'), $($case.vibrance));
  adjustment.putInteger(s2t('saturation'), $($case.saturation));
  adjustmentLayer.putObject(s2t('type'), s2t('vibrance'), adjustment);
"@
    } elseif ($Adjustment -eq 'color-vibrance') {
      $adjustmentDescriptor = @"
  var adjustment = new ActionDescriptor();
  adjustment.putInteger(s2t('temperature'), $($case.temperature));
  adjustment.putInteger(s2t('tint'), $($case.tint));
  adjustment.putBoolean(s2t('useLegacy'), false);
  adjustment.putInteger(s2t('vibrance'), $($case.vibrance));
  adjustment.putInteger(s2t('saturation'), $($case.saturation));
  adjustmentLayer.putObject(s2t('type'), s2t('vibrance'), adjustment);
"@
    } elseif ($Adjustment -eq 'color-balance') {
      $adjustmentDescriptor = @"
  var adjustment = new ActionDescriptor();
  var shadows = new ActionList();
  shadows.putInteger($($case.shadows[0])); shadows.putInteger($($case.shadows[1])); shadows.putInteger($($case.shadows[2]));
  adjustment.putList(c2t('ShdL'), shadows);
  var midtones = new ActionList();
  midtones.putInteger($($case.midtones[0])); midtones.putInteger($($case.midtones[1])); midtones.putInteger($($case.midtones[2]));
  adjustment.putList(c2t('MdtL'), midtones);
  var highlights = new ActionList();
  highlights.putInteger($($case.highlights[0])); highlights.putInteger($($case.highlights[1])); highlights.putInteger($($case.highlights[2]));
  adjustment.putList(c2t('HghL'), highlights);
  adjustment.putBoolean(c2t('PrsL'), $(if ($case.preserveLuminosity) { 'true' } else { 'false' }));
  adjustmentLayer.putObject(s2t('type'), s2t('colorBalance'), adjustment);
"@
    } elseif ($Adjustment -eq 'black-white') {
      $adjustmentDescriptor = @"
  var adjustment = new ActionDescriptor();
  adjustment.putInteger(c2t('Rd  '), $($case.mix[0]));
  adjustment.putInteger(c2t('Yllw'), $($case.mix[1]));
  adjustment.putInteger(c2t('Grn '), $($case.mix[2]));
  adjustment.putInteger(c2t('Cyn '), $($case.mix[3]));
  adjustment.putInteger(c2t('Bl  '), $($case.mix[4]));
  adjustment.putInteger(c2t('Mgnt'), $($case.mix[5]));
  adjustment.putBoolean(s2t('useTint'), $(if ($case.tint) { 'true' } else { 'false' }));
  var tintColor = new ActionDescriptor();
  tintColor.putDouble(c2t('Rd  '), $($case.tintColor[0]));
  tintColor.putDouble(c2t('Grn '), $($case.tintColor[1]));
  tintColor.putDouble(c2t('Bl  '), $($case.tintColor[2]));
  adjustment.putObject(s2t('tintColor'), s2t('RGBColor'), tintColor);
  adjustment.putInteger(s2t('bwPresetKind'), 5);
  adjustment.putString(s2t('blackAndWhitePresetFileName'), '');
  adjustmentLayer.putObject(s2t('type'), s2t('blackAndWhite'), adjustment);
"@
    } elseif ($Adjustment -eq 'channel-mixer') {
      $matrixDescriptors = if ($case.monochrome) {
@"
  var gray = new ActionDescriptor();
  gray.putUnitDouble(s2t('red'), s2t('percentUnit'), $($case.gray[0]));
  gray.putUnitDouble(s2t('grain'), s2t('percentUnit'), $($case.gray[1]));
  gray.putUnitDouble(s2t('blue'), s2t('percentUnit'), $($case.gray[2]));
  gray.putUnitDouble(s2t('constant'), s2t('percentUnit'), $($case.gray[3]));
  adjustment.putObject(s2t('gray'), s2t('channelMatrix'), gray);
"@
      } else {
@"
  var red = new ActionDescriptor();
  red.putUnitDouble(s2t('red'), s2t('percentUnit'), $($case.red[0]));
  red.putUnitDouble(s2t('grain'), s2t('percentUnit'), $($case.red[1]));
  red.putUnitDouble(s2t('blue'), s2t('percentUnit'), $($case.red[2]));
  red.putUnitDouble(s2t('constant'), s2t('percentUnit'), $($case.red[3]));
  adjustment.putObject(s2t('red'), s2t('channelMatrix'), red);
  var green = new ActionDescriptor();
  green.putUnitDouble(s2t('red'), s2t('percentUnit'), $($case.green[0]));
  green.putUnitDouble(s2t('grain'), s2t('percentUnit'), $($case.green[1]));
  green.putUnitDouble(s2t('blue'), s2t('percentUnit'), $($case.green[2]));
  green.putUnitDouble(s2t('constant'), s2t('percentUnit'), $($case.green[3]));
  adjustment.putObject(s2t('grain'), s2t('channelMatrix'), green);
  var blue = new ActionDescriptor();
  blue.putUnitDouble(s2t('red'), s2t('percentUnit'), $($case.blue[0]));
  blue.putUnitDouble(s2t('grain'), s2t('percentUnit'), $($case.blue[1]));
  blue.putUnitDouble(s2t('blue'), s2t('percentUnit'), $($case.blue[2]));
  blue.putUnitDouble(s2t('constant'), s2t('percentUnit'), $($case.blue[3]));
  adjustment.putObject(s2t('blue'), s2t('channelMatrix'), blue);
"@
      }
      $adjustmentDescriptor = @"
  var adjustment = new ActionDescriptor();
  adjustment.putEnumerated(s2t('presetKind'), s2t('presetKindType'), s2t('presetKindCustom'));
  adjustment.putBoolean(s2t('monochromatic'), $(if ($case.monochrome) { 'true' } else { 'false' }));
$matrixDescriptors
  adjustmentLayer.putObject(s2t('type'), s2t('channelMixer'), adjustment);
"@
    } elseif ($Adjustment -eq 'invert') {
      $adjustmentDescriptor = @"
  var adjustment = new ActionDescriptor();
  adjustmentLayer.putObject(s2t('type'), c2t('Invr'), adjustment);
"@
    } elseif ($Adjustment -eq 'posterize') {
      $adjustmentDescriptor = @"
  var adjustment = new ActionDescriptor();
  adjustment.putInteger(c2t('Lvls'), $($case.levels));
  adjustmentLayer.putObject(s2t('type'), c2t('Pstr'), adjustment);
"@
    } elseif ($Adjustment -eq 'threshold') {
      $adjustmentDescriptor = @"
  var adjustment = new ActionDescriptor();
  adjustment.putInteger(c2t('Lvl '), $($case.level));
  adjustmentLayer.putObject(s2t('type'), c2t('Thrs'), adjustment);
"@
    } elseif ($Adjustment -eq 'selective-color') {
      $rangeIds = @('Rds ', 'Ylws', 'Grns', 'Cyns', 'Bls ', 'Mgnt', 'Whts', 'Ntrl', 'Blks')
      $rangeId = $rangeIds[$case.rangeIndex]
      $adjustmentDescriptor = @"
  var adjustment = new ActionDescriptor();
  adjustment.putEnumerated(s2t('presetKind'), s2t('presetKindType'), s2t('presetKindCustom'));
  var corrections = new ActionList();
  var correction = new ActionDescriptor();
  correction.putEnumerated(c2t('Clrs'), c2t('Clrs'), c2t('$rangeId'));
  correction.putUnitDouble(c2t('Cyn '), c2t('#Prc'), $($case.cmyk[0]));
  correction.putUnitDouble(c2t('Mgnt'), c2t('#Prc'), $($case.cmyk[1]));
  correction.putUnitDouble(c2t('Ylw '), c2t('#Prc'), $($case.cmyk[2]));
  correction.putUnitDouble(c2t('Blck'), c2t('#Prc'), $($case.cmyk[3]));
  corrections.putObject(c2t('ClrC'), correction);
  adjustment.putList(c2t('ClrC'), corrections);
  adjustment.putEnumerated(c2t('Mthd'), c2t('CrcM'), c2t('$(if ($case.method -eq 'absolute') { 'Absl' } else { 'Rltv' })'));
  adjustmentLayer.putObject(s2t('type'), c2t('SlcC'), adjustment);
"@
    } elseif ($Adjustment -eq 'gradient-map') {
      $colorStopCalls = ($case.colorStops | ForEach-Object {
@"
  addColorStop(colors, $($_.location), $($_.midpoint), $($_.color[0]), $($_.color[1]), $($_.color[2]));
"@
      }) -join ''
      $opacityStopCalls = ($case.opacityStops | ForEach-Object {
@"
  addOpacityStop(opacity, $($_.location), $($_.midpoint), $($_.opacity));
"@
      }) -join ''
      $adjustmentDescriptor = @"
  var adjustment = new ActionDescriptor();
  adjustment.putBoolean(c2t('Dthr'), $(if ($case.dither) { 'true' } else { 'false' }));
  adjustment.putBoolean(c2t('Rvrs'), $(if ($case.reverse) { 'true' } else { 'false' }));
  adjustment.putEnumerated(s2t('gradientsInterpolationMethod'), s2t('gradientInterpolationMethodType'), s2t('classic'));
  var gradient = new ActionDescriptor();
  gradient.putString(c2t('Nm  '), 'LightTable parity');
  gradient.putEnumerated(c2t('GrdF'), c2t('GrdF'), c2t('CstS'));
  gradient.putBoolean(c2t('ShTr'), true);
  gradient.putDouble(c2t('Intr'), 4096);
  function addColorStop(list, location, midpoint, red, green, blue) {
    var stop = new ActionDescriptor();
    var color = new ActionDescriptor();
    color.putDouble(c2t('Rd  '), red); color.putDouble(c2t('Grn '), green); color.putDouble(c2t('Bl  '), blue);
    stop.putObject(c2t('Clr '), s2t('RGBColor'), color);
    stop.putEnumerated(c2t('Type'), c2t('Clry'), c2t('UsrS'));
    stop.putInteger(c2t('Lctn'), location); stop.putInteger(c2t('Mdpn'), midpoint);
    list.putObject(c2t('Clrt'), stop);
  }
  function addOpacityStop(list, location, midpoint, value) {
    var stop = new ActionDescriptor();
    stop.putUnitDouble(c2t('Opct'), c2t('#Prc'), value);
    stop.putInteger(c2t('Lctn'), location); stop.putInteger(c2t('Mdpn'), midpoint);
    list.putObject(c2t('TrnS'), stop);
  }
  var colors = new ActionList();
$colorStopCalls
  gradient.putList(c2t('Clrs'), colors);
  var opacity = new ActionList();
$opacityStopCalls
  gradient.putList(c2t('Trns'), opacity);
  adjustment.putObject(c2t('Grad'), c2t('Grdn'), gradient);
  adjustmentLayer.putObject(s2t('type'), c2t('GdMp'), adjustment);
"@
    } elseif ($Adjustment -eq 'photo-filter') {
      $adjustmentDescriptor = @"
  var adjustment = new ActionDescriptor();
  var filterColor = new ActionDescriptor();
  filterColor.putDouble(c2t('Rd  '), $($case.color[0]));
  filterColor.putDouble(c2t('Grn '), $($case.color[1]));
  filterColor.putDouble(c2t('Bl  '), $($case.color[2]));
  adjustment.putObject(c2t('Clr '), s2t('RGBColor'), filterColor);
  adjustment.putInteger(c2t('Dnst'), $($case.density));
  adjustment.putBoolean(c2t('PrsL'), $(if ($case.preserveLuminosity) { 'true' } else { 'false' }));
  adjustmentLayer.putObject(s2t('type'), s2t('photoFilter'), adjustment);
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
