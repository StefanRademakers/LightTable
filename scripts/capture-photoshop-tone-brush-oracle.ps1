param(
  [string]$Output = "D:\mediavibe\LightTableTests\ToneBrush",
  [ValidateSet('grayscale', 'color')]
  [string]$Corpus = 'grayscale'
)

$ErrorActionPreference = 'Stop'
$outputPath = [IO.Path]::GetFullPath($Output)
$sourceName = if ($Corpus -eq 'color') { 'color-gradients.png' } else { 'grayscale-ramp.png' }
$sourcePath = Join-Path $outputPath "source\$sourceName"
$photoshopPath = Join-Path $outputPath $(if ($Corpus -eq 'color') { 'photoshop-color' } else { 'photoshop' })
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "Tone-brush source is missing: $sourcePath. Run npm run prepare:tone-brush-oracle first."
}
New-Item -ItemType Directory -Path $photoshopPath -Force | Out-Null

function JsString([string]$value) {
  return '"' + $value.Replace('\', '/').Replace('"', '\"') + '"'
}

$tools = @(
  @{ name='dodge'; toolClass='DdTl'; modes=@{ shadows='dodgeS'; midtones='dodgeM'; highlights='dodgeH' } },
  @{ name='burn'; toolClass='BrTl'; modes=@{ shadows='burnInS'; midtones='burnInM'; highlights='burnInH' } }
)
$cases = @()
foreach ($tool in $tools) {
  foreach ($range in @('shadows', 'midtones', 'highlights')) {
    $exposures = if ($Corpus -eq 'color') { @(20) } else { @(5, 10, 20, 25, 50) }
    foreach ($exposure in $exposures) {
      foreach ($protect in @($false, $true)) {
        $protectLabel = if ($protect) { 'protected' } else { 'legacy' }
        $cases += @{
          id="$($tool.name)-$range-$exposure-$protectLabel"
          toolClass=$tool.toolClass
          mode=$tool.modes[$range]
          exposure=$exposure
          protect=$protect
        }
      }
    }
  }
}

$photoshop = $null
$results = @()
try {
  $photoshop = [Runtime.InteropServices.Marshal]::GetActiveObject('Photoshop.Application')
  $photoshop.DisplayDialogs = 3
  foreach ($case in $cases) {
    $target = Join-Path $photoshopPath "$($case.id).png"
    $protectJs = if ($case.protect) { 'true' } else { 'false' }
    $strokeRows = if ($Corpus -eq 'color') { '48,144,240,336,432,528,624,720' } else { '128' }
    $script = @"
var c2t = charIDToTypeID, s2t = stringIDToTypeID;
var previousRulerUnits = app.preferences.rulerUnits;
app.preferences.rulerUnits = Units.PIXELS;
var doc = app.open(new File($(JsString $sourcePath)));
try {
  var select = new ActionDescriptor();
  var selectedTool = new ActionReference();
  selectedTool.putClass(c2t($(JsString $case.toolClass)));
  select.putReference(c2t('null'), selectedTool);
  executeAction(c2t('slct'), select, DialogModes.NO);

  var set = new ActionDescriptor();
  var target = new ActionReference();
  target.putClass(c2t($(JsString $case.toolClass)));
  set.putReference(c2t('null'), target);
  var options = new ActionDescriptor();
  options.putEnumerated(s2t('mode'), s2t('blendMode'), s2t($(JsString $case.mode)));
  options.putInteger(s2t('exposure'), $($case.exposure));
  options.putBoolean(s2t('useLegacy'), !$protectJs);
  var brush = new ActionDescriptor();
  brush.putDouble(s2t('diameter'), 128);
  brush.putDouble(s2t('hardness'), 100);
  brush.putDouble(s2t('angle'), 0);
  brush.putDouble(s2t('roundness'), 100);
  brush.putDouble(s2t('spacing'), 25);
  options.putObject(s2t('brush'), s2t('computedBrush'), brush);
  set.putObject(c2t('T   '), c2t($(JsString $case.toolClass)), options);
  executeAction(c2t('setd'), set, DialogModes.NO);

  var application = new ActionReference();
  application.putEnumerated(c2t('capp'), c2t('Ordn'), c2t('Trgt'));
  var actual = executeActionGet(application).getObjectValue(c2t('CrnT'));
  var actualMode = typeIDToStringID(actual.getEnumerationValue(s2t('mode')));
  var actualExposure = actual.getInteger(s2t('exposure'));
  var actualProtect = !actual.getBoolean(s2t('useLegacy'));
  var actualBrush = actual.getObjectValue(s2t('brush'));
  var actualDiameter = actualBrush.getDouble(s2t('diameter'));
  var actualHardness = actualBrush.getDouble(s2t('hardness'));
  var actualSpacing = actualBrush.getDouble(s2t('spacing'));
  if (actualMode !== $(JsString $case.mode) || actualExposure !== $($case.exposure) || actualProtect !== $protectJs ||
      Math.abs(actualDiameter - 128) > 0.01 || Math.abs(actualHardness - 100) > 0.01 ||
      Math.abs(actualSpacing - 25) > 0.01) {
    throw new Error('Photoshop rejected tone settings: ' + actualMode + '/' + actualExposure + '/' + actualProtect +
      '/' + actualDiameter + '/' + actualHardness + '/' + actualSpacing);
  }

  // Photoshop's PathPointInfo coordinates are points, independent of ruler units.
  // Convert the intended document pixels so the oracle also works with source files
  // whose embedded resolution is not 72 ppi.
  var pointPerPixel = 72 / doc.resolution;
  var strokeRows = [$strokeRows];
  for (var rowIndex = 0; rowIndex < strokeRows.length; rowIndex++) {
    var strokeY = strokeRows[rowIndex];
    var first = new PathPointInfo();
    first.kind = PointKind.CORNERPOINT;
    first.anchor = [0, strokeY * pointPerPixel]; first.leftDirection = first.anchor; first.rightDirection = first.anchor;
    var last = new PathPointInfo();
    last.kind = PointKind.CORNERPOINT;
    last.anchor = [doc.width.as('px') * pointPerPixel, strokeY * pointPerPixel]; last.leftDirection = last.anchor; last.rightDirection = last.anchor;
    var subpath = new SubPathInfo();
    subpath.closed = false; subpath.operation = ShapeOperation.SHAPEADD; subpath.entireSubPath = [first, last];
    var path = doc.pathItems.add('LightTable tone oracle stroke ' + rowIndex, [subpath]);
    var stroke = new ActionDescriptor();
    var activePath = new ActionReference();
    activePath.putEnumerated(c2t('Path'), c2t('Ordn'), c2t('Trgt'));
    stroke.putReference(c2t('null'), activePath);
    stroke.putClass(c2t('Usng'), c2t($(JsString $case.toolClass)));
    executeAction(c2t('Strk'), stroke, DialogModes.NO);
    path.remove();
  }

  var png = new PNGSaveOptions(); png.interlaced = false;
  doc.saveAs(new File($(JsString $target)), png, true, Extension.LOWERCASE);
  doc.close(SaveOptions.DONOTSAVECHANGES);
  app.preferences.rulerUnits = previousRulerUnits;
  '$( $case.id )|' + actualMode + '|' + actualExposure + '|' + actualProtect + '|' + actualDiameter + '|' + actualHardness + '|' + actualSpacing;
} catch (error) {
  try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (_) {}
  app.preferences.rulerUnits = previousRulerUnits;
  throw error;
}
"@
    try {
      $verified = $photoshop.DoJavaScript($script)
      $results += [pscustomobject]@{ id=$case.id; status='captured'; settings=$verified; file=$target }
    } catch {
      try { if ($photoshop.Documents.Count -gt 0) { $photoshop.ActiveDocument.Close(2) } } catch {}
      $results += [pscustomobject]@{ id=$case.id; status='failed'; error=$_.Exception.Message }
    }
  }
} finally {
  if ($null -ne $photoshop) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($photoshop) }
}

$manifest = Join-Path $outputPath $(if ($Corpus -eq 'color') { 'photoshop-color-manifest.json' } else { 'photoshop-manifest.json' })
$results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifest -Encoding utf8
$results | Format-Table id,status,settings -AutoSize
if ($results.Where({ $_.status -ne 'captured' }).Count) {
  throw "Photoshop tone-brush oracle failed; see $manifest"
}
Write-Host "Photoshop tone-brush oracle: $manifest"
