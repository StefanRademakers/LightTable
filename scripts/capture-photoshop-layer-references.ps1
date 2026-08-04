param(
  [string]$Plan = "work/done/task_049_psd_template_corpus_feature_audit/suspect-capture-plan.json",
  [string]$CorpusRoot = "D:\mediavibe\LightTableTestFiles\psd\templates\Save the Date Invitation PSD 6",
  [string]$Output = "tmp/task-049/suspect-references/photoshop"
)

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$planPath = (Resolve-Path (Join-Path $workspace $Plan)).Path
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $workspace $Output))
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$captures = Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json
$photoshop = New-Object -ComObject Photoshop.Application
$photoshop.Visible = $true

function JsString([string]$value) {
  return '"' + $value.Replace('\', '/').Replace('"', '\"') + '"'
}

$results = @()
foreach ($capture in $captures) {
  $documentDirectory = Get-ChildItem -LiteralPath $CorpusRoot -Recurse -Filter "$($capture.document).psd" |
    Select-Object -First 1
  if (-not $documentDirectory) { throw "PSD not found: $($capture.document)" }
  $stem = "$($capture.document)-$($capture.address.Replace('.', '_'))-$($capture.cluster)"
  $contextPath = Join-Path $outputPath "$stem-context.png"
  $soloPath = Join-Path $outputPath "$stem-solo.png"
  $script = @"
app.displayDialogs = DialogModes.NO;
var doc = app.open(new File($(JsString $documentDirectory.FullName)));
function collect(collection, result) {
  for (var i = 0; i < collection.length; i++) {
    var layer = collection[i];
    result.push([layer, layer.visible]);
    if (layer.typename === 'LayerSet') collect(layer.layers, result);
  }
}
function findAddress(root, address) {
  var parts = address.split('.');
  var current = root;
  var ancestors = [];
  for (var i = 0; i < parts.length; i++) {
    var sourceIndex = parseInt(parts[i], 10);
    current = current.layers[current.layers.length - 1 - sourceIndex];
    if (!current) throw new Error('Layer address not found: ' + address);
    ancestors.push(current);
  }
  return ancestors;
}
function restore(states) {
  for (var i = 0; i < states.length; i++) states[i][0].visible = states[i][1];
}
function exportPng(fileName) {
  var options = new PNGSaveOptions();
  options.interlaced = false;
  doc.saveAs(new File(fileName), options, true, Extension.LOWERCASE);
}
var states = [];
collect(doc.layers, states);
var chain = findAddress(doc, $(JsString $capture.address));
if (chain[chain.length - 1].name !== $(JsString $capture.name)) {
  throw new Error('Layer name mismatch at $($capture.address): ' + chain[chain.length - 1].name);
}
exportPng($(JsString $contextPath));
for (var i = 0; i < states.length; i++) states[i][0].visible = false;
for (var i = 0; i < chain.length; i++) chain[i].visible = true;
exportPng($(JsString $soloPath));
restore(states);
doc.close(SaveOptions.DONOTSAVECHANGES);
"@
  try {
    $photoshop.DoJavaScript($script)
    $results += [pscustomobject]@{
      document = $capture.document
      address = $capture.address
      name = $capture.name
      cluster = $capture.cluster
      context = $contextPath
      solo = $soloPath
      status = 'captured'
    }
  } catch {
    try { $photoshop.ActiveDocument.Close(2) } catch {}
    $results += [pscustomobject]@{
      document = $capture.document
      address = $capture.address
      name = $capture.name
      cluster = $capture.cluster
      status = 'failed'
      error = $_.Exception.Message
    }
  }
}
$reportPath = Join-Path $outputPath 'manifest.json'
$results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $reportPath -Encoding utf8
$results | Format-Table document,address,name,cluster,status -AutoSize
Write-Host "Photoshop suspect-layer references: $reportPath"
