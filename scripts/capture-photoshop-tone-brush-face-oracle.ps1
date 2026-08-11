param(
  [string]$Source = 'D:\face.jpg',
  [string]$Output = 'D:\mediavibe\LightTableTests\ToneBrush\face\photoshop'
)

$ErrorActionPreference = 'Stop'
$sourcePath = [IO.Path]::GetFullPath($Source)
$outputPath = [IO.Path]::GetFullPath($Output)
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Missing source: $sourcePath" }
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null

function JsString([string]$value) {
  return '"' + $value.Replace('\', '/').Replace('"', '\"') + '"'
}

$photoshop = $null
try {
  $photoshop = [Runtime.InteropServices.Marshal]::GetActiveObject('Photoshop.Application')
  $photoshop.DisplayDialogs = 3
  foreach ($protect in @($false, $true)) {
    foreach ($repeat in @(1, 2, 5, 10, 20)) {
      $mode = if ($protect) { 'protected' } else { 'legacy' }
      $targetPath = Join-Path $outputPath "dodge-midtones-e20-$mode-r$repeat.png"
      $protectJs = if ($protect) { 'true' } else { 'false' }
      $script = @"
var c2t = charIDToTypeID, s2t = stringIDToTypeID;
var oldUnits = app.preferences.rulerUnits;
app.preferences.rulerUnits = Units.PIXELS;
var doc = app.open(new File($(JsString $sourcePath)));
try {
  var select = new ActionDescriptor(), selectedTool = new ActionReference();
  selectedTool.putClass(c2t('DdTl')); select.putReference(c2t('null'), selectedTool);
  executeAction(c2t('slct'), select, DialogModes.NO);
  var set = new ActionDescriptor(), target = new ActionReference();
  target.putClass(c2t('DdTl')); set.putReference(c2t('null'), target);
  var options = new ActionDescriptor();
  options.putEnumerated(s2t('mode'), s2t('blendMode'), s2t('dodgeM'));
  options.putInteger(s2t('exposure'), 20);
  options.putBoolean(s2t('useLegacy'), !$protectJs);
  var brush = new ActionDescriptor();
  brush.putDouble(s2t('diameter'), 250); brush.putDouble(s2t('hardness'), 75);
  brush.putDouble(s2t('angle'), 0); brush.putDouble(s2t('roundness'), 100);
  brush.putDouble(s2t('spacing'), 25);
  options.putObject(s2t('brush'), s2t('computedBrush'), brush);
  set.putObject(c2t('T   '), c2t('DdTl'), options);
  executeAction(c2t('setd'), set, DialogModes.NO);

  var pointPerPixel = 72 / doc.resolution;
  for (var pass = 0; pass < $repeat; pass++) {
    var first = new PathPointInfo(); first.kind = PointKind.CORNERPOINT;
    first.anchor = [350 * pointPerPixel, 235 * pointPerPixel];
    first.leftDirection = first.anchor; first.rightDirection = first.anchor;
    var last = new PathPointInfo(); last.kind = PointKind.CORNERPOINT;
    last.anchor = [351 * pointPerPixel, 235 * pointPerPixel];
    last.leftDirection = last.anchor; last.rightDirection = last.anchor;
    var subpath = new SubPathInfo(); subpath.closed = false;
    subpath.operation = ShapeOperation.SHAPEADD; subpath.entireSubPath = [first, last];
    var path = doc.pathItems.add('LightTable face tone pass ' + pass, [subpath]);
    var stroke = new ActionDescriptor(), activePath = new ActionReference();
    activePath.putEnumerated(c2t('Path'), c2t('Ordn'), c2t('Trgt'));
    stroke.putReference(c2t('null'), activePath); stroke.putClass(c2t('Usng'), c2t('DdTl'));
    executeAction(c2t('Strk'), stroke, DialogModes.NO); path.remove();
  }
  var png = new PNGSaveOptions(); png.interlaced = false;
  doc.saveAs(new File($(JsString $targetPath)), png, true, Extension.LOWERCASE);
  doc.close(SaveOptions.DONOTSAVECHANGES); app.preferences.rulerUnits = oldUnits;
} catch (error) {
  try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (_) {}
  app.preferences.rulerUnits = oldUnits; throw error;
}
"@
      [void]$photoshop.DoJavaScript($script)
      Write-Host "Photoshop face oracle: $targetPath"
    }
  }
} finally {
  if ($null -ne $photoshop) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($photoshop) }
}
