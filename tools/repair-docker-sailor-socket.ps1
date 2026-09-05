#requires -RunAsAdministrator

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeDirectory = Join-Path $workspaceRoot '.uvh-runtime'
$resultPath = Join-Path $runtimeDirectory 'docker-repair.result.log'
if (-not (Test-Path -LiteralPath $runtimeDirectory -PathType Container)) {
    New-Item -ItemType Directory -Path $runtimeDirectory | Out-Null
}

trap {
    # Persist only the concise exception message. This file contains no process
    # dump, environment variables, credentials or Docker configuration.
    Set-Content -LiteralPath $resultPath -Value $_.Exception.Message -Encoding UTF8
    exit 1
}

$localAppDataRoot = [IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd([IO.Path]::DirectorySeparatorChar)
$runtimeTargets = @(
    [IO.Path]::GetFullPath((Join-Path $localAppDataRoot 'Docker\run')),
    [IO.Path]::GetFullPath((Join-Path $localAppDataRoot 'docker-secrets-engine'))
)
foreach ($target in $runtimeTargets) {
    if (-not $target.StartsWith($localAppDataRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Una ruta de runtime no pertenece a LOCALAPPDATA.'
    }
}
$archivedRuntimes = [Collections.Generic.List[string]]::new()

# Docker must not recreate or retain the endpoint while its reparse point is
# being repaired. These names are specific to Docker Desktop, not user apps.
Get-Process -Name 'Docker Desktop', 'com.docker.backend', 'com.docker.build' -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
$dockerService = Get-Service -Name 'com.docker.service' -ErrorAction SilentlyContinue
$restartDockerService = $null -ne $dockerService -and $dockerService.Status -eq 'Running'
if ($restartDockerService) {
    Stop-Service -Name 'com.docker.service' -Force -ErrorAction Stop
}
& wsl.exe --terminate docker-desktop 2>$null | Out-Null
$wslService = Get-Service -Name 'WslService' -ErrorAction SilentlyContinue
$restartWslService = $null -ne $wslService -and $wslService.Status -eq 'Running'
try {
    if ($restartWslService) {
        Stop-Service -Name 'WslService' -Force -ErrorAction Stop
        (Get-Service -Name 'WslService').WaitForStatus('Stopped', [TimeSpan]::FromSeconds(15))
    }
    Start-Sleep -Seconds 2

    foreach ($target in $runtimeTargets) {
        if (-not (Test-Path -LiteralPath $target -PathType Container)) {
            continue
        }
        # Archive whole IPC directories because Windows error 1920 can make an
        # individual AF_UNIX reparse point impossible to inspect or delete.
        # The move is reversible and leaves Docker to recreate clean endpoints.
        $targetItem = Get-Item -LiteralPath $target -Force -ErrorAction Stop
        if (($targetItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "$target es un reparse point inesperado; no se modificó."
        }
        $archive = $target + '.stale-' + [DateTime]::Now.ToString('yyyyMMdd-HHmmss')
        if (Test-Path -LiteralPath $archive) {
            $archive += '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
        }
        Move-Item -LiteralPath $target -Destination $archive -ErrorAction Stop
        $archivedRuntimes.Add($archive)
    }
} finally {
    if ($restartWslService) {
        Start-Service -Name 'WslService' -ErrorAction Stop
        (Get-Service -Name 'WslService').WaitForStatus('Running', [TimeSpan]::FromSeconds(15))
    }
    if ($restartDockerService) {
        Start-Service -Name 'com.docker.service' -ErrorAction Stop
        (Get-Service -Name 'com.docker.service').WaitForStatus('Running', [TimeSpan]::FromSeconds(15))
    }
}

$successMessage = if ($archivedRuntimes.Count -eq 0) {
    'No había directorios IPC de Docker que reparar.'
} else {
    "Runtime IPC de Docker archivado de forma recuperable: $($archivedRuntimes -join '; ')."
}
Set-Content -LiteralPath $resultPath -Value $successMessage -Encoding UTF8
Write-Output $successMessage
