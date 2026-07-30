[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath(
    (Join-Path -Path $PSScriptRoot -ChildPath '..')
).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
)
$repoPrefix = $repoRoot + [System.IO.Path]::DirectorySeparatorChar

# Only generated development output belongs here. Release packages, dependencies,
# source files, documents and user data are intentionally left untouched.
$generatedPaths = @(
    'apps\desktop\.vite',
    'node_modules\.vite',
    'apps\desktop\node_modules\.vite',
    'apps\web\node_modules\.vite',
    'packages\lighttable-app\node_modules\.vite'
)

foreach ($relativePath in $generatedPaths) {
    $targetPath = [System.IO.Path]::GetFullPath(
        (Join-Path -Path $repoRoot -ChildPath $relativePath)
    )

    if (-not $targetPath.StartsWith(
        $repoPrefix,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Refusing to clean a path outside the LightTable repository: $targetPath"
    }

    if (-not (Test-Path -LiteralPath $targetPath)) {
        Write-Host "[LightTable] Already clean: $relativePath"
        continue
    }

    if ($PSCmdlet.ShouldProcess($targetPath, 'Remove generated development cache')) {
        Remove-Item -LiteralPath $targetPath -Recurse -Force
        Write-Host "[LightTable] Removed: $relativePath"
    }
}

Write-Host '[LightTable] Development caches are clean.'
