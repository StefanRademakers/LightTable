param(
  [Parameter(Mandatory = $true)][string]$PsdPath,
  [Parameter(Mandatory = $true)][string]$PngPath,
  [Parameter(Mandatory = $true)][string]$LayersPath
)
$ErrorActionPreference = 'Stop'
$photoshop = $null
$document = $null
$options = $null
try {
  $resolvedPsd = (Resolve-Path -LiteralPath $PsdPath).Path
  $resolvedPng = [IO.Path]::GetFullPath($PngPath)
  $resolvedLayers = [IO.Path]::GetFullPath($LayersPath)
  $photoshop = New-Object -ComObject Photoshop.Application
  $photoshop.DisplayDialogs = 3
  $document = $photoshop.Open($resolvedPsd)
  $layers = for ($index = 1; $index -le $document.Layers.Count; $index += 1) {
    $layer = $document.Layers.Item($index)
    [PSCustomObject]@{ name = $layer.Name; kind = [int]$layer.Kind }
  }
  $options = New-Object -ComObject Photoshop.PNGSaveOptions
  $options.Interlaced = $false
  $document.SaveAs($resolvedPng, $options, $true)
  $layers | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $resolvedLayers -Encoding utf8
} finally {
  if ($null -ne $document) { $document.Close(2) }
  foreach ($value in @($options, $document, $photoshop)) {
    if ($null -ne $value) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($value) }
  }
}
