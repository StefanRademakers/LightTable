param(
  [string]$Plan = "architecture/reference/implementation/LAYER_STYLE_REFERENCE_PLAN.json",
  [string]$CorpusRoot = "D:\mediavibe\LightTableTestFiles\psd\templates\Save the Date Invitation PSD 6",
  [string]$Output = "tmp/task-050/layer-styles/photoshop"
)

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$planPath = (Resolve-Path (Join-Path $workspace $Plan)).Path
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $workspace $Output))
if (-not $outputPath.StartsWith($workspace + [System.IO.Path]::DirectorySeparatorChar)) {
  throw 'Photoshop reference output must stay inside the LightTable workspace.'
}
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$captures = Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json
$photoshop = New-Object -ComObject Photoshop.Application
$originalDialogs = $photoshop.DisplayDialogs
$photoshop.DisplayDialogs = 3
$photoshop.Visible = $true

function JsString([string]$value) {
  return '"' + $value.Replace('\', '/').Replace('"', '\"') + '"'
}

$results = @()
try {
  foreach ($capture in $captures) {
    $source = Get-ChildItem -LiteralPath $CorpusRoot -Recurse -Filter "$($capture.document).psd" |
      Select-Object -First 1
    if (-not $source) { throw "PSD not found: $($capture.document)" }
    $stem = "$($capture.document)-$($capture.address.Replace('.', '_'))-$($capture.name.Replace(' ', '_'))"
    $enabledPath = Join-Path $outputPath "$stem-enabled.png"
    $bypassedPath = Join-Path $outputPath "$stem-bypassed.png"
    $script = @"
app.displayDialogs = DialogModes.NO;
var doc = app.open(new File($(JsString $source.FullName)));
function findAddress(root, address) {
  var parts = address.split('.');
  var current = root;
  for (var i = 0; i < parts.length; i++) {
    var sourceIndex = parseInt(parts[i], 10);
    current = current.layers[current.layers.length - 1 - sourceIndex];
    if (!current) throw new Error('Layer address not found: ' + address);
  }
  return current;
}
function bypassEffects(layer) {
  doc.activeLayer = layer;
  executeAction(stringIDToTypeID('disableLayerStyle'), undefined, DialogModes.NO);
}
function exportPng(fileName) {
  var options = new PNGSaveOptions();
  options.interlaced = false;
  doc.saveAs(new File(fileName), options, true, Extension.LOWERCASE);
}
var layer = findAddress(doc, $(JsString $capture.address));
if (layer.name !== $(JsString $capture.name)) throw new Error('Layer name mismatch: ' + layer.name);
exportPng($(JsString $enabledPath));
bypassEffects(layer);
exportPng($(JsString $bypassedPath));
doc.close(SaveOptions.DONOTSAVECHANGES);
"@
    try {
      $photoshop.DoJavaScript($script)
      $results += [pscustomobject]@{
        document = $capture.document; address = $capture.address; name = $capture.name
        effects = $capture.effects; enabled = $enabledPath; bypassed = $bypassedPath; status = 'captured'
      }
    } catch {
      try { $photoshop.ActiveDocument.Close(2) } catch {}
      $results += [pscustomobject]@{
        document = $capture.document; address = $capture.address; name = $capture.name
        effects = $capture.effects; status = 'failed'; error = $_.Exception.Message
      }
    }
  }
} finally {
  $photoshop.DisplayDialogs = $originalDialogs
}
$reportPath = Join-Path $outputPath 'manifest.json'
$results | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding utf8
$results | Format-Table document,address,name,status -AutoSize
if ($results.Where({ $_.status -ne 'captured' }).Count) { throw "Photoshop layer-style capture failed; see $reportPath" }
Write-Host "Photoshop layer-style references: $reportPath"
