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

function Get-LightTableDevelopmentProcesses {
    $processes = @(Get-CimInstance -ClassName Win32_Process)
    $byId = @{}

    foreach ($process in $processes) {
        $byId[[int]$process.ProcessId] = $process
    }

    $matchedIds = [System.Collections.Generic.HashSet[int]]::new()

    foreach ($process in $processes) {
        $executablePath = [string]$process.ExecutablePath
        $commandLine = [string]$process.CommandLine
        $belongsToRepository =
            $executablePath.StartsWith(
                $repoPrefix,
                [System.StringComparison]::OrdinalIgnoreCase
            ) -or
            $commandLine.IndexOf(
                $repoRoot,
                [System.StringComparison]::OrdinalIgnoreCase
            ) -ge 0

        if ($belongsToRepository -and $process.Name -in @('node.exe', 'electron.exe')) {
            [void]$matchedIds.Add([int]$process.ProcessId)
        }
    }

    # Include descendants even when Chromium omits the repository path from a
    # child command line. This keeps the cleanup scoped to the matched
    # LightTable process tree.
    $foundDescendant = $true
    while ($foundDescendant) {
        $foundDescendant = $false

        foreach ($process in $processes) {
            if (
                $matchedIds.Contains([int]$process.ParentProcessId) -and
                $matchedIds.Add([int]$process.ProcessId)
            ) {
                $foundDescendant = $true
            }
        }
    }

    # npm's wrapper processes do not include the working directory in their
    # command line and Windows inserts cmd.exe between each npm script. Walk
    # the ancestor chain, but include only Node ancestors. The cmd/PowerShell
    # hosts themselves remain untouched.
    foreach ($processId in @($matchedIds)) {
        $current = $byId[$processId]
        $remainingLevels = 12

        while ($null -ne $current -and $remainingLevels -gt 0) {
            $parent = $byId[[int]$current.ParentProcessId]
            if ($null -eq $parent) {
                break
            }

            if ($parent.Name -eq 'node.exe') {
                [void]$matchedIds.Add([int]$parent.ProcessId)
            }

            $current = $parent
            $remainingLevels -= 1
        }
    }

    return @(
        $processes |
            Where-Object { $matchedIds.Contains([int]$_.ProcessId) }
    )
}

function Stop-LightTableDevelopmentProcesses {
    $processes = @(Get-LightTableDevelopmentProcesses)
    if ($processes.Count -eq 0) {
        Write-Host '[LightTable] No existing desktop development process found.'
        return
    }

    $processIds = @($processes | ForEach-Object { [int]$_.ProcessId })
    $allProcessesById = @{}
    Get-CimInstance -ClassName Win32_Process | ForEach-Object {
        $allProcessesById[[int]$_.ProcessId] = $_
    }

    function Get-ProcessDepth([int]$processId) {
        $depth = 0
        $current = $allProcessesById[$processId]
        $remainingLevels = 32

        while ($null -ne $current -and $remainingLevels -gt 0) {
            $depth += 1
            $current = $allProcessesById[[int]$current.ParentProcessId]
            $remainingLevels -= 1
        }

        return $depth
    }

    $orderedProcesses = @(
        $processes |
            Sort-Object -Property @{
                Expression = { Get-ProcessDepth -processId ([int]$_.ProcessId) }
                Descending = $true
            }
    )

    Write-Host (
        '[LightTable] Stopping existing desktop development process tree: {0}' -f
        (($orderedProcesses | ForEach-Object { "$($_.Name)#$($_.ProcessId)" }) -join ', ')
    )

    foreach ($process in $orderedProcesses) {
        if ($PSCmdlet.ShouldProcess(
            "$($process.Name) PID $($process.ProcessId)",
            'Stop existing LightTable development process'
        )) {
            Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
        }
    }

    if ($WhatIfPreference) {
        return
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
        $remaining = @(
            $processIds |
                Where-Object { $null -ne (Get-Process -Id $_ -ErrorAction SilentlyContinue) }
        )
        if ($remaining.Count -eq 0) {
            Write-Host '[LightTable] Existing desktop development process stopped.'
            return
        }

        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)

    throw (
        'Timed out while stopping existing LightTable development processes: {0}' -f
        ($remaining -join ', ')
    )
}

# Vite's optimized dependency cache is part of the running server contract.
# Stop the repository-owned dev tree before deleting it, otherwise an existing
# PSD worker can keep referencing an ag-psd bundle that the clean removed.
Stop-LightTableDevelopmentProcesses

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
