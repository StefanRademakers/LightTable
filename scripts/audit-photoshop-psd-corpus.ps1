param(
  [string]$Inventory = "work\done\task_049_psd_template_corpus_feature_audit\corpus-inventory.json",
  [string]$OutputDirectory = "tmp\task-049\photoshop"
)

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$inventoryPath = (Resolve-Path (Join-Path $workspace $Inventory)).Path
$outputRoot = [System.IO.Path]::GetFullPath((Join-Path $workspace $OutputDirectory))
if (-not $outputRoot.StartsWith($workspace, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Photoshop audit output must stay inside the LightTable workspace."
}
[System.IO.Directory]::CreateDirectory($outputRoot) | Out-Null
$corpus = Get-Content -LiteralPath $inventoryPath -Raw | ConvertFrom-Json
$photoshop = New-Object -ComObject Photoshop.Application
$originalDialogs = $photoshop.DisplayDialogs
$originalDocumentPath = $null
$initialDocumentPaths = [System.Collections.Generic.HashSet[string]]::new(
  [System.StringComparer]::OrdinalIgnoreCase
)
for ($index = 1; $index -le $photoshop.Documents.Count; $index += 1) {
  $existing = $photoshop.Documents.Item($index)
  try {
    $existingPath = [System.IO.Path]::GetFullPath([string]$existing.FullName)
    $initialDocumentPaths.Add($existingPath) | Out-Null
    if ($existing.Name -eq $photoshop.ActiveDocument.Name) { $originalDocumentPath = $existingPath }
  }
  catch {
    # Untitled documents have no FullName and are intentionally never closed.
  }
}
$results = [System.Collections.Generic.List[object]]::new()

function Convert-ToJsString([string]$Value) {
  return ($Value | ConvertTo-Json -Compress)
}

function Read-PhotoshopLayerTree($Application) {
  $script = @'
(function () {
  function json(value) {
    if (value === null) return 'null';
    if (typeof value === 'string') return '"' + value
      .replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      .replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Array) {
      var parts = [];
      for (var arrayIndex = 0; arrayIndex < value.length; arrayIndex += 1) {
        parts.push(json(value[arrayIndex]));
      }
      return '[' + parts.join(',') + ']';
    }
    var properties = [];
    for (var key in value) {
      if (value.hasOwnProperty(key) && value[key] !== undefined) {
        properties.push(json(key) + ':' + json(value[key]));
      }
    }
    return '{' + properties.join(',') + '}';
  }
  function number(value) {
    try { return value.as('px'); } catch (_) { return Number(value); }
  }
  function bounds(layer) {
    try {
      var value = layer.bounds;
      return [number(value[0]), number(value[1]), number(value[2]), number(value[3])];
    } catch (_) { return null; }
  }
  function visit(container, parent, result) {
    for (var index = 0; index < container.layers.length; index += 1) {
      var layer = container.layers[index];
      var address = parent === null ? String(index) : parent + '.' + index;
      var entry = {
        address: address,
        name: layer.name,
        typename: layer.typename,
        visible: layer.visible,
        opacity: layer.opacity,
        blendMode: String(layer.blendMode),
        bounds: bounds(layer)
      };
      if (layer.typename === 'ArtLayer') {
        entry.kind = Number(layer.kind);
        entry.grouped = layer.grouped;
        if (Number(layer.kind) === 2) {
          try { entry.font = layer.textItem.font; } catch (_) {}
        }
      }
      result.push(entry);
      if (layer.typename === 'LayerSet') visit(layer, address, result);
    }
  }
  var layers = [];
  visit(app.activeDocument, null, layers);
  return json({
    name: app.activeDocument.name,
    width: number(app.activeDocument.width),
    height: number(app.activeDocument.height),
    mode: String(app.activeDocument.mode),
    bitsPerChannel: Number(app.activeDocument.bitsPerChannel),
    layers: layers
  });
}())
'@
  return $Application.DoJavaScript($script) | ConvertFrom-Json
}

function Export-PhotoshopComposite($Application, [string]$Target) {
  $targetLiteral = Convert-ToJsString $Target
  $script = @"
(function () {
  var target = File($targetLiteral);
  var options = new ExportOptionsSaveForWeb();
  options.format = SaveDocumentType.JPEG;
  options.quality = 78;
  options.includeProfile = true;
  options.interlaced = false;
  options.optimized = true;
  app.activeDocument.exportDocument(target, ExportType.SAVEFORWEB, options);
}())
"@
  $Application.DoJavaScript($script) | Out-Null
}

try {
  $photoshop.DisplayDialogs = 3
  foreach ($document in $corpus.documents) {
    $source = [System.IO.Path]::GetFullPath([string]$document.source)
    if (-not [System.IO.File]::Exists($source)) { throw "Missing PSD: $source" }
    if ($initialDocumentPaths.Contains($source)) {
      $results.Add([pscustomobject]@{
        id = $document.id
        source = $source
        skipped = 'Source was already open before the audit and was left untouched.'
      })
      continue
    }
    $opened = $null
    $openedByAudit = $false
    try {
      $documentCountBeforeOpen = $photoshop.Documents.Count
      $opened = $photoshop.Open($source)
      $openedByAudit = $photoshop.Documents.Count -gt $documentCountBeforeOpen
      if (-not $openedByAudit) {
        throw 'Photoshop did not create a distinct audit document; refusing to touch an existing document.'
      }
      $photoshop.ActiveDocument = $opened
      $metadata = Read-PhotoshopLayerTree $photoshop
      $target = Join-Path $outputRoot ("{0}-photoshop.jpg" -f $document.id)
      Export-PhotoshopComposite $photoshop $target
      $results.Add([pscustomobject]@{
        id = $document.id
        source = $source
        composite = $target
        metadata = $metadata
      })
    }
    catch {
      $results.Add([pscustomobject]@{
        id = $document.id
        source = $source
        error = $_.Exception.Message
      })
    }
    finally {
      if ($openedByAudit -and $null -ne $opened) { $opened.Close(2) }
    }
  }
}
finally {
  $photoshop.DisplayDialogs = $originalDialogs
  if ($null -ne $originalDocumentPath) {
    for ($index = 1; $index -le $photoshop.Documents.Count; $index += 1) {
      $candidate = $photoshop.Documents.Item($index)
      try {
        if ([System.IO.Path]::GetFullPath([string]$candidate.FullName) -eq $originalDocumentPath) {
          $photoshop.ActiveDocument = $candidate
          break
        }
      }
      catch {}
    }
  }
}

$reportPath = Join-Path $outputRoot 'photoshop-corpus.json'
[System.IO.File]::WriteAllText(
  $reportPath,
  (($results | ConvertTo-Json -Depth 12) + [Environment]::NewLine),
  [System.Text.UTF8Encoding]::new($false)
)
[pscustomobject]@{
  report = $reportPath
  documents = $results.Count
  failures = @($results | Where-Object { $_.error }).Count
  skipped = @($results | Where-Object { $_.skipped }).Count
} | ConvertTo-Json -Compress
