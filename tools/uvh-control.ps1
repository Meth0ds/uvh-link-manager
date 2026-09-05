param(
    [ValidateSet('Gui', 'Status', 'Start', 'Stop', 'Restart', 'Migrate', 'RepairDocker', 'FollowDockerLogs', 'FollowFrontendLogs')]
    [string] $Mode = 'Gui'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try {
    # Child command modes redirect to UTF-8 files consumed by the WinForms UI.
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
} catch {
    # Some hosts do not expose a writable console; the GUI can still operate.
}

$script:SelfPath = [IO.Path]::GetFullPath($PSCommandPath)
$script:Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:ComposeFile = Join-Path $script:Root 'docker-compose.local.yml'
$script:EnvFile = Join-Path $script:Root '.env.docker.local'
$script:EnvExample = Join-Path $script:Root '.env.docker.local.example'
$script:FrontendDir = Join-Path $script:Root 'frontend'
$script:MigrationDir = Join-Path $script:Root 'backend-laravel\database\migrations'
$script:DockerRepairScript = Join-Path $PSScriptRoot 'repair-docker-sailor-socket.ps1'
$script:RuntimeDir = Join-Path $script:Root '.uvh-runtime'
$script:FrontendProcessFile = Join-Path $script:RuntimeDir 'frontend.process.json'
$script:FrontendProcessTempFile = Join-Path $script:RuntimeDir 'frontend.process.tmp'
$script:FrontendOutLog = Join-Path $script:RuntimeDir 'frontend.out.log'
$script:FrontendErrLog = Join-Path $script:RuntimeDir 'frontend.err.log'

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory)]
        [string] $FilePath,
        [string[]] $Arguments = @()
    )

    # Windows PowerShell 5 surfaces native stderr as a non-terminating error.
    # Capture it deliberately so callers can decide from the real exit code.
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $captured = @(& $FilePath @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }

    return [PSCustomObject]@{
        ExitCode = [int] $exitCode
        Output = (($captured | ForEach-Object { [string] $_ }) -join "`r`n").TrimEnd()
    }
}

function Initialize-Runtime {
    if (-not (Test-Path -LiteralPath $script:RuntimeDir -PathType Container)) {
        New-Item -ItemType Directory -Path $script:RuntimeDir | Out-Null
    }
}

function Initialize-LocalEnvironment {
    Initialize-Runtime
    if (-not (Test-Path -LiteralPath $script:EnvFile -PathType Leaf)) {
        if (-not (Test-Path -LiteralPath $script:EnvExample -PathType Leaf)) {
            throw 'No existe .env.docker.local ni su plantilla.'
        }
        Copy-Item -LiteralPath $script:EnvExample -Destination $script:EnvFile
    }
}

function Get-LocalDatabaseName {
    if (-not (Test-Path -LiteralPath $script:EnvFile -PathType Leaf)) {
        return 'uvh_local (se creará desde la plantilla)'
    }

    $line = Get-Content -LiteralPath $script:EnvFile |
        Where-Object { $_ -match '^\s*POSTGRES_DB\s*=' } |
        Select-Object -Last 1
    $value = if ($null -eq $line) { 'uvh_local' } else { ($line -replace '^\s*POSTGRES_DB\s*=\s*', '').Trim().Trim('"', "'") }
    if ($value -notmatch '^[A-Za-z0-9_.-]{1,63}$') {
        throw 'POSTGRES_DB contiene un nombre no válido para la consola local.'
    }

    return $value
}

function Get-LocalDatabaseUser {
    if (-not (Test-Path -LiteralPath $script:EnvFile -PathType Leaf)) {
        return 'uvh_local'
    }

    $line = Get-Content -LiteralPath $script:EnvFile |
        Where-Object { $_ -match '^\s*POSTGRES_USER\s*=' } |
        Select-Object -Last 1
    $value = if ($null -eq $line) { 'uvh_local' } else { ($line -replace '^\s*POSTGRES_USER\s*=\s*', '').Trim().Trim('"', "'") }
    if ($value -notmatch '^[A-Za-z0-9_.-]{1,63}$') {
        throw 'POSTGRES_USER contiene un nombre no válido para la consola local.'
    }

    return $value
}

function Assert-DockerReady {
    $docker = Get-Command docker -ErrorAction Stop
    $result = Invoke-NativeCommand -FilePath $docker.Source -Arguments @('info', '--format', '{{.ServerVersion}}')
    if ($result.ExitCode -ne 0) {
        throw "Docker Desktop no está disponible: $($result.Output)"
    }
}

function Get-KnownDockerStartupFailure {
    param([Parameter(Mandatory)][DateTime] $SinceUtc)

    $backendLog = Join-Path $env:LOCALAPPDATA 'Docker\log\host\com.docker.backend.exe.log'
    if (-not (Test-Path -LiteralPath $backendLog -PathType Leaf)) {
        return $null
    }

    foreach ($line in @(Get-Content -LiteralPath $backendLog -Tail 240 -ErrorAction SilentlyContinue) | Select-Object -Last 240) {
        if ($line -notmatch '^\[(?<at>[^\]]+)\].*(?:initializing Ingest server|initializing Secrets Engine).*no tiene acceso al archivo') {
            continue
        }
        $loggedAt = [DateTime]::MinValue
        if (-not [DateTime]::TryParse(
            $Matches.at,
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AdjustToUniversal,
            [ref] $loggedAt
        )) {
            continue
        }
        if ($loggedAt.ToUniversalTime() -ge $SinceUtc.AddSeconds(-2)) {
            return 'Docker Desktop no puede reemplazar un socket IPC local. Pulsa Reparar Docker y acepta UAC; no se eliminarán imágenes ni volúmenes.'
        }
    }

    return $null
}

function Ensure-DockerReady {
    $docker = Get-Command docker -ErrorAction Stop
    $current = Invoke-NativeCommand -FilePath $docker.Source -Arguments @('info', '--format', '{{.ServerVersion}}')
    if ($current.ExitCode -eq 0) {
        return "Docker disponible · servidor $($current.Output)."
    }

    $desktopCandidates = @(
        (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'),
        (Join-Path $env:LOCALAPPDATA 'Docker\Docker Desktop.exe')
    )
    $desktopExecutable = $desktopCandidates |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
    if ([string]::IsNullOrWhiteSpace([string] $desktopExecutable)) {
        throw "Docker está instalado, pero su motor no responde y no se encontró Docker Desktop.`r`n$($current.Output)"
    }

    $startupBeganAt = [DateTime]::UtcNow
    $desktopRunning = Get-Process -Name 'Docker Desktop', 'com.docker.backend' -ErrorAction SilentlyContinue
    if ($null -eq $desktopRunning) {
        # Docker Desktop 4.x has exhibited an unbounded wait in its own
        # `docker desktop start --detach --timeout` command. Launching the
        # installed executable returns immediately, so the readiness deadline
        # below remains enforceable by UVH instead of by that unreliable CLI.
        Start-Process -FilePath $desktopExecutable -WindowStyle Hidden | Out-Null
    }

    $deadline = [DateTime]::UtcNow.AddMinutes(3)
    $lastFailure = $current.Output
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Seconds 2
        $probe = Invoke-NativeCommand -FilePath $docker.Source -Arguments @('info', '--format', '{{.ServerVersion}}')
        if ($probe.ExitCode -eq 0) {
            return "Docker Desktop iniciado · servidor $($probe.Output)."
        }
        if (-not [string]::IsNullOrWhiteSpace($probe.Output)) {
            $lastFailure = $probe.Output
        }
        $knownFailure = Get-KnownDockerStartupFailure -SinceUtc $startupBeganAt
        if ($null -ne $knownFailure) {
            throw $knownFailure
        }
    }

    throw "Docker Desktop no estuvo listo en tres minutos. Abre Docker Desktop y revisa su diagnóstico.`r`n$lastFailure"
}

function Invoke-DockerSocketRepair {
    if (-not (Test-Path -LiteralPath $script:DockerRepairScript -PathType Leaf)) {
        throw 'No se encontró la herramienta de reparación de Docker.'
    }

    Initialize-Runtime
    $repairResultPath = Join-Path $script:RuntimeDir 'docker-repair.result.log'
    if (Test-Path -LiteralPath $repairResultPath -PathType Leaf) {
        Remove-Item -LiteralPath $repairResultPath -Force
    }
    $scriptArgument = '"' + $script:DockerRepairScript.Replace('"', '""') + '"'
    try {
        # UAC is intentionally delegated to Windows. The helper has one narrow
        # target and cannot modify images, volumes, registries or project data.
        $repair = Start-Process `
            -FilePath 'powershell.exe' `
            -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $scriptArgument) `
            -Verb RunAs `
            -WindowStyle Hidden `
            -Wait `
            -PassThru
    } catch {
        throw 'La elevación UAC se canceló o Windows no pudo iniciar la reparación.'
    }
    if ($repair.ExitCode -ne 0) {
        $detail = if (Test-Path -LiteralPath $repairResultPath -PathType Leaf) {
            ([string] (Get-Content -LiteralPath $repairResultPath -Raw -Encoding UTF8)).Trim()
        } else { '' }
        if ([string]::IsNullOrWhiteSpace($detail)) {
            $detail = "La reparación elevada terminó con código $($repair.ExitCode)."
        }
        throw $detail
    }

    $result = if (Test-Path -LiteralPath $repairResultPath -PathType Leaf) {
        ([string] (Get-Content -LiteralPath $repairResultPath -Raw -Encoding UTF8)).Trim()
    } else { 'Socket local de Docker reparado.' }

    return "$result Ya puedes pulsar Iniciar todo."
}

function Invoke-UvhCompose {
    param(
        [Parameter(Mandatory)]
        [string[]] $Arguments,
        [switch] $AllowFailure,
        [switch] $PassThru
    )

    Initialize-LocalEnvironment
    $allArguments = @(
        'compose',
        '-f', $script:ComposeFile,
        '--env-file', $script:EnvFile,
        '--profile', 'laravel'
    ) + $Arguments
    $docker = Get-Command docker -ErrorAction Stop
    $result = Invoke-NativeCommand -FilePath $docker.Source -Arguments $allArguments
    if (-not $AllowFailure -and $result.ExitCode -ne 0) {
        throw ($(if ([string]::IsNullOrWhiteSpace($result.Output)) { 'Docker Compose devolvió un error.' } else { $result.Output }))
    }

    if ($PassThru) {
        return $result
    }

    return $result.Output
}

function Get-LocalMigrationStatus {
    if (-not (Test-Path -LiteralPath $script:MigrationDir -PathType Container)) {
        return 'NO DISPONIBLE · no existe el directorio de migraciones'
    }

    $available = @(Get-ChildItem -LiteralPath $script:MigrationDir -Filter '*.php' -File |
        Sort-Object Name |
        ForEach-Object { $_.BaseName })
    if ($available.Count -eq 0) {
        return 'NO DISPONIBLE · no hay migraciones locales'
    }

    # No password crosses the process boundary: psql connects through the
    # container's local socket. User/database names are separately validated
    # and passed as argv values, never interpolated into a shell command.
    $databaseName = Get-LocalDatabaseName
    $databaseUser = Get-LocalDatabaseUser
    # Keep the structured result local instead of passing it through the
    # string-oriented Compose helper; Windows PowerShell can otherwise unwrap
    # the object's Output member while returning from nested functions.
    $docker = Get-Command docker -ErrorAction Stop
    $probe = Invoke-NativeCommand -FilePath $docker.Source -Arguments @(
        'compose', '-f', $script:ComposeFile, '--env-file', $script:EnvFile,
        '--profile', 'laravel', 'exec', '-T', 'postgres',
        'psql', '-U', $databaseUser, '-d', $databaseName, '-Atc',
        'SELECT migration FROM migrations ORDER BY id'
    )
    if ($probe.ExitCode -ne 0) {
        return 'NO DISPONIBLE · no se pudo leer la tabla migrations'
    }

    $appliedSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($line in ($probe.Output -split "`r?`n")) {
        $name = $line.Trim()
        if ($name -ne '') {
            $null = $appliedSet.Add($name)
        }
    }
    $pending = @($available | Where-Object { -not $appliedSet.Contains($_) })

    return $(if ($pending.Count -eq 0) {
        "AL DÍA · $($available.Count) aplicadas"
    } else {
        "PENDIENTES · $($pending.Count) de $($available.Count) · $($appliedSet.Count) aplicadas · usa Aplicar migraciones"
    })
}

function Get-FrontendProcess {
    if (-not (Test-Path -LiteralPath $script:FrontendProcessFile -PathType Leaf)) {
        return $null
    }

    try {
        $metadata = Get-Content -LiteralPath $script:FrontendProcessFile -Raw | ConvertFrom-Json
        if ([int] $metadata.schema -ne 1) {
            throw 'Versión de metadatos no reconocida.'
        }
        $processId = [int] $metadata.pid
        $expectedStart = [DateTime]::Parse(
            [string] $metadata.startedAt,
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::RoundtripKind
        ).ToUniversalTime()
    } catch {
        Remove-Item -LiteralPath $script:FrontendProcessFile -Force
        return $null
    }

    try {
        $metadataRoot = [IO.Path]::GetFullPath([string] $metadata.root)
    } catch {
        Remove-Item -LiteralPath $script:FrontendProcessFile -Force
        return $null
    }
    if ($processId -lt 1 -or -not [string]::Equals($metadataRoot, $script:Root, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $script:FrontendProcessFile -Force
        return $null
    }

    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        Remove-Item -LiteralPath $script:FrontendProcessFile -Force
        return $null
    }
    $commandLine = [string] $process.CommandLine
    if ([string]::IsNullOrWhiteSpace($commandLine) -or
        $commandLine -notmatch '(?i)npm(?:\.cmd)?\s+start\s+--\s+--host\s+127\.0\.0\.1\s+--port\s+4200') {
        Remove-Item -LiteralPath $script:FrontendProcessFile -Force
        return $null
    }

    try {
        $actualStart = (Get-Process -Id $processId -ErrorAction Stop).StartTime.ToUniversalTime()
    } catch {
        Remove-Item -LiteralPath $script:FrontendProcessFile -Force
        return $null
    }
    if ([Math]::Abs(($actualStart - $expectedStart).TotalSeconds) -gt 2) {
        # A reused PID must never grant this tool authority over another process.
        Remove-Item -LiteralPath $script:FrontendProcessFile -Force
        return $null
    }

    return $process
}

function Assert-FrontendPortAvailable {
    $listener = Get-NetTCPConnection -LocalPort 4200 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -ne $listener) {
        throw "El puerto 4200 ya está ocupado por el PID $($listener.OwningProcess). Detén ese proceso o cambia su puerto antes de iniciar UVH."
    }
}

function Start-Frontend {
    Initialize-Runtime
    $existing = Get-FrontendProcess
    if ($null -ne $existing) {
        return "Frontend ya iniciado (PID $($existing.ProcessId))."
    }
    Assert-FrontendPortAvailable

    $npm = Get-Command npm.cmd -ErrorAction Stop
    if (-not (Test-Path -LiteralPath (Join-Path $script:FrontendDir 'node_modules') -PathType Container)) {
        Push-Location $script:FrontendDir
        try {
            $install = Invoke-NativeCommand -FilePath $npm.Source -Arguments @('ci', '--no-audit', '--no-fund')
            if ($install.ExitCode -ne 0) {
                throw "npm ci falló:`r`n$($install.Output)"
            }
        } finally {
            Pop-Location
        }
    }

    foreach ($logPath in @($script:FrontendOutLog, $script:FrontendErrLog)) {
        if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) {
            New-Item -ItemType File -Path $logPath | Out-Null
        }
    }
    $process = Start-Process `
        -FilePath $env:ComSpec `
        -ArgumentList @('/d', '/s', '/c', 'npm.cmd start -- --host 127.0.0.1 --port 4200') `
        -WorkingDirectory $script:FrontendDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $script:FrontendOutLog `
        -RedirectStandardError $script:FrontendErrLog `
        -PassThru
    try {
        $metadata = [ordered]@{
            schema = 1
            pid = $process.Id
            startedAt = $process.StartTime.ToUniversalTime().ToString('O')
            root = $script:Root
        } | ConvertTo-Json -Compress
        # Commit ownership metadata atomically. A truncated JSON file after a
        # power loss must never make the launcher guess which process it owns.
        Set-Content -LiteralPath $script:FrontendProcessTempFile -Value $metadata -Encoding utf8
        Move-Item -LiteralPath $script:FrontendProcessTempFile -Destination $script:FrontendProcessFile -Force
    } catch {
        # An untracked process must not be left behind if ownership metadata
        # cannot be committed to the workspace runtime directory.
        $null = Invoke-NativeCommand -FilePath 'taskkill.exe' -Arguments @('/PID', [string] $process.Id, '/T', '/F')
        if (Test-Path -LiteralPath $script:FrontendProcessTempFile -PathType Leaf) {
            Remove-Item -LiteralPath $script:FrontendProcessTempFile -Force
        }
        throw
    }

    Start-Sleep -Milliseconds 400
    if ($null -eq (Get-FrontendProcess)) {
        $lastError = if (Test-Path -LiteralPath $script:FrontendErrLog -PathType Leaf) {
            (Get-Content -LiteralPath $script:FrontendErrLog -Tail 12 | Out-String).Trim()
        } else { '' }
        $message = if ($lastError) { "El frontend terminó durante el arranque:`r`n$lastError" } else { 'El frontend terminó durante el arranque.' }
        throw $message
    }

    return "Frontend iniciado (PID $($process.Id))."
}

function Stop-Frontend {
    $process = Get-FrontendProcess
    if ($null -eq $process) {
        return 'Frontend ya detenido.'
    }

    # The PID, exact command and creation time were validated above. Try a
    # normal process-tree termination first; force is a bounded fallback only.
    $termination = Invoke-NativeCommand -FilePath 'taskkill.exe' -Arguments @('/PID', [string] $process.ProcessId, '/T')
    Start-Sleep -Milliseconds 500
    $forced = $false
    if (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue) {
        $forced = $true
        $termination = Invoke-NativeCommand -FilePath 'taskkill.exe' -Arguments @('/PID', [string] $process.ProcessId, '/T', '/F')
        if ($termination.ExitCode -ne 0 -and (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue)) {
            throw "No se pudo detener el frontend PID $($process.ProcessId):`r`n$($termination.Output)"
        }
    }
    if (Test-Path -LiteralPath $script:FrontendProcessFile -PathType Leaf) {
        Remove-Item -LiteralPath $script:FrontendProcessFile -Force
    }

    return "Frontend detenido (PID $($process.ProcessId))$(if ($forced) { ' · cierre forzado tras espera.' } else { '.' })"
}

function Start-UvhLocal {
    Initialize-LocalEnvironment
    $docker = Ensure-DockerReady
    # A routine start should reuse the current image. Compose still builds an
    # absent image, while avoiding a full rebuild on every button press.
    $compose = Invoke-UvhCompose -Arguments @('up', '-d', 'postgres', 'app', 'queue', 'schedule')
    $frontend = Start-Frontend

    return (($docker, $compose, $frontend | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join "`r`n")
}

function Stop-UvhLocal {
    $frontend = Stop-Frontend
    $compose = ''
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        $compose = Invoke-UvhCompose -Arguments @('stop') -AllowFailure
    }

    return (($frontend, $compose | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join "`r`n")
}

function Invoke-UvhMigrations {
    $docker = Ensure-DockerReady
    Write-Output $docker
    return Invoke-UvhCompose -Arguments @('run', '--rm', 'php', 'php', 'artisan', 'migrate', '--force', '--no-interaction')
}

function Test-HttpEndpoint {
    param(
        [Parameter(Mandatory)][string] $Url,
        [int] $TimeoutSeconds = 12
    )

    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    try {
        $response = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec $TimeoutSeconds -UseBasicParsing
        $elapsed = [Math]::Round($stopwatch.Elapsed.TotalSeconds, 1)
        $availability = if ($elapsed -ge 3) { 'LENTO' } else { 'OK' }

        return "$availability · HTTP $([int] $response.StatusCode) · ${elapsed}s"
    } catch {
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            return "ERROR · HTTP $([int] $_.Exception.Response.StatusCode)"
        }
        return "NO DISPONIBLE · $([Math]::Round($stopwatch.Elapsed.TotalSeconds, 1))s"
    }
}

function Get-UvhStatus {
    $lines = [Collections.Generic.List[string]]::new()
    $lines.Add("Actualizado: $([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss'))")
    $lines.Add('')

    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        $lines.Add('Docker: NO INSTALADO')
    } else {
        $docker = Get-Command docker -ErrorAction Stop
        $dockerResult = Invoke-NativeCommand -FilePath $docker.Source -Arguments @('info', '--format', '{{.ServerVersion}}')
        if ($dockerResult.ExitCode -ne 0) {
            $lines.Add('Docker: NO DISPONIBLE')
        } else {
            $lines.Add("Docker: OK · servidor $($dockerResult.Output)")
            if (-not (Test-Path -LiteralPath $script:EnvFile -PathType Leaf)) {
                $lines.Add('Entorno local: NO CONFIGURADO · falta .env.docker.local')
            } else {
                try {
                    $lines.Add("Base local: $(Get-LocalDatabaseName)")
                    $services = Invoke-UvhCompose -Arguments @('ps', '--format', 'table {{.Service}}\t{{.State}}\t{{.Status}}') -AllowFailure
                    $lines.Add('')
                    $lines.Add('Servicios Docker')
                    $lines.Add($(if ([string]::IsNullOrWhiteSpace($services)) { 'Sin servicios iniciados.' } else { $services }))
                    $lines.Add("Migraciones: $(Get-LocalMigrationStatus)")
                } catch {
                    $lines.Add("Estado Compose no disponible: $($_.Exception.Message)")
                }
            }
        }
    }

    $frontend = Get-FrontendProcess
    $lines.Add('')
    $lines.Add($(if ($null -eq $frontend) { 'Frontend: DETENIDO' } else { "Frontend: EN EJECUCIÓN · PID $($frontend.ProcessId)" }))
    $lines.Add("Backend /health: $(Test-HttpEndpoint 'http://127.0.0.1:8000/health')")
    $lines.Add("Frontend web:    $(Test-HttpEndpoint 'http://127.0.0.1:4200/')")

    return $lines -join "`r`n"
}

function Follow-DockerLogs {
    Initialize-LocalEnvironment
    Assert-DockerReady
    $arguments = @(
        'compose', '-f', $script:ComposeFile, '--env-file', $script:EnvFile,
        '--profile', 'laravel', 'logs', '--follow', '--tail', '120',
        'postgres', 'app', 'queue', 'schedule'
    )
    & docker @arguments
}

function Follow-FrontendLogs {
    Initialize-Runtime
    foreach ($logPath in @($script:FrontendOutLog, $script:FrontendErrLog)) {
        if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) {
            New-Item -ItemType File -Path $logPath | Out-Null
        }
    }
    Get-Content -LiteralPath @($script:FrontendOutLog, $script:FrontendErrLog) -Tail 100 -Wait
}

if ($Mode -ne 'Gui') {
    try {
        $commandOutput = switch ($Mode) {
            'Status' { Get-UvhStatus }
            'Start' { Start-UvhLocal }
            'Stop' { Stop-UvhLocal }
            'Restart' { Stop-UvhLocal; Start-UvhLocal }
            'Migrate' { Invoke-UvhMigrations }
            'RepairDocker' { Invoke-DockerSocketRepair }
            'FollowDockerLogs' { Follow-DockerLogs }
            'FollowFrontendLogs' { Follow-FrontendLogs }
        }
        if ($null -ne $commandOutput) {
            Write-Output $commandOutput
        }
        exit 0
    } catch {
        [Console]::Error.WriteLine($_.Exception.Message)
        exit 1
    }
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

# One control window per checkout prevents competing start/stop operations from
# racing over the same Compose project and frontend ownership metadata.
$mutexHasher = [Security.Cryptography.SHA256]::Create()
try {
    $mutexDigest = $mutexHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($script:Root))
} finally {
    $mutexHasher.Dispose()
}
$mutexSuffix = (($mutexDigest | Select-Object -First 10 | ForEach-Object { $_.ToString('x2') }) -join '')
$script:GuiMutex = [Threading.Mutex]::new($false, "Local\UVH-Control-$mutexSuffix")
$script:GuiMutexOwned = $false
try {
    $script:GuiMutexOwned = $script:GuiMutex.WaitOne(0, $false)
} catch [Threading.AbandonedMutexException] {
    $script:GuiMutexOwned = $true
}
if (-not $script:GuiMutexOwned) {
    [Windows.Forms.MessageBox]::Show(
        'Ya hay un panel UVH abierto para este proyecto.',
        'UVH · Control local',
        [Windows.Forms.MessageBoxButtons]::OK,
        [Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
    $script:GuiMutex.Dispose()
    exit 0
}

Initialize-Runtime
$staleOperationCutoff = [DateTime]::Now.AddHours(-1)
Get-ChildItem -LiteralPath $script:RuntimeDir -Filter 'operation-*.log' -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $staleOperationCutoff } |
    Remove-Item -Force -ErrorAction SilentlyContinue

$form = [Windows.Forms.Form]::new()
$form.Text = 'UVH · Control local'
$form.Size = [Drawing.Size]::new(900, 650)
$form.MinimumSize = [Drawing.Size]::new(760, 560)
$form.StartPosition = 'CenterScreen'
$form.BackColor = [Drawing.Color]::FromArgb(246, 248, 252)
$form.Font = [Drawing.Font]::new('Segoe UI', 10)

$header = [Windows.Forms.Panel]::new()
$header.Dock = 'Top'
$header.Height = 86
$header.BackColor = [Drawing.Color]::FromArgb(8, 20, 38)
$form.Controls.Add($header)

$title = [Windows.Forms.Label]::new()
$title.Text = 'UVH · Control local'
$title.ForeColor = [Drawing.Color]::White
$title.Font = [Drawing.Font]::new('Segoe UI Semibold', 19)
$title.AutoSize = $true
$title.Location = [Drawing.Point]::new(24, 15)
$header.Controls.Add($title)

$subtitle = [Windows.Forms.Label]::new()
$subtitle.Text = 'Laravel, PostgreSQL, cola, scheduler y Angular desde un único panel.'
$subtitle.ForeColor = [Drawing.Color]::FromArgb(173, 191, 217)
$subtitle.AutoSize = $true
$subtitle.Location = [Drawing.Point]::new(27, 52)
$header.Controls.Add($subtitle)

$toolbar = [Windows.Forms.FlowLayoutPanel]::new()
$toolbar.Dock = 'Top'
$toolbar.Height = 104
$toolbar.Padding = [Windows.Forms.Padding]::new(18, 15, 18, 8)
$toolbar.WrapContents = $true
$toolbar.BackColor = $form.BackColor
$form.Controls.Add($toolbar)
$toolbar.BringToFront()

function New-ControlButton {
    param([string] $Text, [Drawing.Color] $BackColor, [Drawing.Color] $ForeColor)
    $button = [Windows.Forms.Button]::new()
    $button.Text = $Text
    $button.AutoSize = $true
    $button.Height = 36
    $button.Padding = [Windows.Forms.Padding]::new(12, 0, 12, 0)
    $button.Margin = [Windows.Forms.Padding]::new(5)
    $button.FlatStyle = 'Flat'
    $button.FlatAppearance.BorderSize = 0
    $button.BackColor = $BackColor
    $button.ForeColor = $ForeColor
    $button.Cursor = [Windows.Forms.Cursors]::Hand
    return $button
}

$startButton = New-ControlButton 'Iniciar todo' ([Drawing.Color]::FromArgb(30, 101, 245)) ([Drawing.Color]::White)
$stopButton = New-ControlButton 'Detener' ([Drawing.Color]::FromArgb(224, 231, 241)) ([Drawing.Color]::FromArgb(25, 42, 66))
$restartButton = New-ControlButton 'Reiniciar' ([Drawing.Color]::FromArgb(224, 231, 241)) ([Drawing.Color]::FromArgb(25, 42, 66))
$refreshButton = New-ControlButton 'Actualizar estado' ([Drawing.Color]::FromArgb(224, 231, 241)) ([Drawing.Color]::FromArgb(25, 42, 66))
$migrateButton = New-ControlButton 'Aplicar migraciones' ([Drawing.Color]::FromArgb(0, 153, 143)) ([Drawing.Color]::White)
$repairDockerButton = New-ControlButton 'Reparar Docker' ([Drawing.Color]::FromArgb(245, 158, 11)) ([Drawing.Color]::FromArgb(8, 20, 38))
$dockerLogsButton = New-ControlButton 'Logs backend' ([Drawing.Color]::FromArgb(224, 231, 241)) ([Drawing.Color]::FromArgb(25, 42, 66))
$frontendLogsButton = New-ControlButton 'Logs frontend' ([Drawing.Color]::FromArgb(224, 231, 241)) ([Drawing.Color]::FromArgb(25, 42, 66))
$openButton = New-ControlButton 'Abrir aplicación' ([Drawing.Color]::FromArgb(8, 20, 38)) ([Drawing.Color]::White)
@($startButton, $stopButton, $restartButton, $refreshButton, $migrateButton, $repairDockerButton, $dockerLogsButton, $frontendLogsButton, $openButton) |
    ForEach-Object { $toolbar.Controls.Add($_) }

$content = [Windows.Forms.SplitContainer]::new()
$content.Dock = 'Fill'
$content.Orientation = 'Horizontal'
$content.SplitterDistance = 225
$content.Panel1.Padding = [Windows.Forms.Padding]::new(22, 8, 22, 8)
$content.Panel2.Padding = [Windows.Forms.Padding]::new(22, 8, 22, 18)
$form.Controls.Add($content)
$content.BringToFront()

$statusBox = [Windows.Forms.TextBox]::new()
$statusBox.Dock = 'Fill'
$statusBox.Multiline = $true
$statusBox.ReadOnly = $true
$statusBox.ScrollBars = 'Vertical'
$statusBox.BackColor = [Drawing.Color]::White
$statusBox.ForeColor = [Drawing.Color]::FromArgb(20, 37, 61)
$statusBox.Font = [Drawing.Font]::new('Cascadia Mono', 9.5)
$statusBox.BorderStyle = 'FixedSingle'
$content.Panel1.Controls.Add($statusBox)

$logBox = [Windows.Forms.TextBox]::new()
$logBox.Dock = 'Fill'
$logBox.Multiline = $true
$logBox.ReadOnly = $true
$logBox.ScrollBars = 'Vertical'
$logBox.BackColor = [Drawing.Color]::FromArgb(8, 20, 38)
$logBox.ForeColor = [Drawing.Color]::FromArgb(211, 223, 240)
$logBox.Font = [Drawing.Font]::new('Cascadia Mono', 9)
$logBox.BorderStyle = 'None'
$content.Panel2.Controls.Add($logBox)

function Write-UiLog {
    param([string] $Message)
    $stamp = [DateTime]::Now.ToString('HH:mm:ss')
    $logBox.AppendText("[$stamp] $Message`r`n")
    $logBox.SelectionStart = $logBox.TextLength
    $logBox.ScrollToCaret()
}

$script:UiOperationProcess = $null
$script:UiOperationLabel = ''
$script:UiOperationMode = ''
$script:UiOperationOutFile = ''
$script:UiOperationErrFile = ''
$script:UiOperationOutOffset = 0
$script:UiOperationErrOffset = 0
$script:UiOperationStartedAt = [DateTime]::MinValue
$script:UiOperationNextHeartbeat = [DateTime]::MinValue
$script:UiOperationTimeoutSeconds = 0
$script:UiOperationTimedOut = $false

function Read-UiOperationLog {
    param(
        [string] $Path,
        [int] $Offset,
        [string] $Prefix = ''
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $Offset
    }

    # FileShare.ReadWrite lets the UI consume progress while the child process
    # keeps writing. Only newly appended characters are rendered.
    try {
        $stream = [IO.FileStream]::new($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
        try {
            $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8, $true)
            try {
                $content = $reader.ReadToEnd()
            } finally {
                $reader.Dispose()
            }
        } finally {
            $stream.Dispose()
        }
    } catch {
        return $Offset
    }

    if ($content.Length -le $Offset) {
        return $Offset
    }
    $newContent = $content.Substring($Offset).TrimEnd("`r", "`n")
    if (-not [string]::IsNullOrWhiteSpace($newContent)) {
        foreach ($line in ($newContent -split "`r?`n")) {
            Write-UiLog "$Prefix$line"
        }
    }

    return $content.Length
}

function Read-UiOperationText {
    param([Parameter(Mandatory)][string] $Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return ''
    }

    # Windows PowerShell 5.1 returns $null, not an empty string, for an empty
    # file read with -Raw. Do not invoke Trim() until that host-specific value
    # has been normalized; a successful child normally leaves stderr empty.
    $content = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if ($null -eq $content) {
        return ''
    }

    return ([string] $content).Trim()
}

function Update-UiStatus {
    Invoke-UiOperation 'Actualizando estado' 'Status'
}

function Invoke-UiOperation {
    param(
        [string] $Label,
        [ValidateSet('Status', 'Start', 'Stop', 'Restart', 'Migrate', 'RepairDocker')]
        [string] $OperationMode
    )

    if ($null -ne $script:UiOperationProcess -and -not $script:UiOperationProcess.HasExited) {
        Write-UiLog 'Ya hay una operación en curso.'
        return
    }

    Initialize-Runtime
    $toolbar.Enabled = $false
    $subtitle.Text = "$Label… La ventana seguirá respondiendo."
    if ($OperationMode -eq 'Status') {
        $statusBox.Text = 'Consultando servicios y salud HTTP…'
        Write-UiLog "$Label…"
    } else {
        Write-UiLog "$Label… El primer arranque puede tardar varios minutos."
    }

    $operationId = [Guid]::NewGuid().ToString('N')
    $script:UiOperationOutFile = Join-Path $script:RuntimeDir "operation-$operationId.out.log"
    $script:UiOperationErrFile = Join-Path $script:RuntimeDir "operation-$operationId.err.log"
    $script:UiOperationOutOffset = 0
    $script:UiOperationErrOffset = 0
    $script:UiOperationLabel = $Label
    $script:UiOperationMode = $OperationMode
    $script:UiOperationStartedAt = [DateTime]::Now
    $script:UiOperationNextHeartbeat = [DateTime]::Now.AddSeconds(10)
    $script:UiOperationTimeoutSeconds = switch ($OperationMode) {
        'Status' { 60 }
        'Stop' { 180 }
        'RepairDocker' { 180 }
        'Migrate' { 900 }
        default { 600 }
    }
    $script:UiOperationTimedOut = $false

    try {
        # PSCommandPath is an automatic variable whose availability can differ
        # inside a delegate. Capture the canonical path during script startup
        # and reuse it for every child invocation.
        $scriptArgument = '"' + $script:SelfPath.Replace('"', '""') + '"'
        $script:UiOperationProcess = Start-Process `
            -FilePath 'powershell.exe' `
            -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $scriptArgument, '-Mode', $OperationMode) `
            -WindowStyle Hidden `
            -RedirectStandardOutput $script:UiOperationOutFile `
            -RedirectStandardError $script:UiOperationErrFile `
            -PassThru
        $script:UiOperationTimer.Start()
    } catch {
        $script:UiOperationProcess = $null
        $toolbar.Enabled = $true
        $subtitle.Text = 'Laravel, PostgreSQL, cola, scheduler y Angular desde un único panel.'
        Write-UiLog "ERROR · $($_.Exception.Message)"
        [Windows.Forms.MessageBox]::Show(
            $form,
            $_.Exception.Message,
            'UVH · Operación no completada',
            [Windows.Forms.MessageBoxButtons]::OK,
            [Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
}

$script:UiOperationTimer = [Windows.Forms.Timer]::new()
$script:UiOperationTimer.Interval = 300
$script:UiOperationTimer.Add_Tick({
    try {
        # WinForms invokes this delegate after the script's main construction
        # scope has finished. Keep both the timer and operation state at script
        # scope, then snapshot the Process once: every method call in this tick
        # targets the same non-null object even if completion starts a refresh.
        $operationProcess = $script:UiOperationProcess
        if ($null -eq $operationProcess) {
            $script:UiOperationTimer.Stop()
            return
        }

        if ($script:UiOperationMode -ne 'Status') {
            $script:UiOperationOutOffset = Read-UiOperationLog $script:UiOperationOutFile $script:UiOperationOutOffset
            $script:UiOperationErrOffset = Read-UiOperationLog $script:UiOperationErrFile $script:UiOperationErrOffset 'ERROR · '
        }

        if (-not $operationProcess.HasExited) {
            $elapsedSeconds = [int] ([DateTime]::Now - $script:UiOperationStartedAt).TotalSeconds
            if ($elapsedSeconds -ge $script:UiOperationTimeoutSeconds) {
                # The child PID comes directly from Start-Process in this window.
                # Killing its tree bounds a stuck CLI without guessing ownership.
                $script:UiOperationTimedOut = $true
                $null = Invoke-NativeCommand -FilePath 'taskkill.exe' -Arguments @(
                    '/PID', [string] $operationProcess.Id, '/T', '/F'
                )
                Write-UiLog "ERROR · Tiempo máximo agotado tras ${elapsedSeconds}s."
                return
            }
            if ([DateTime]::Now -ge $script:UiOperationNextHeartbeat) {
                Write-UiLog "Operación en curso · ${elapsedSeconds}s."
                $script:UiOperationNextHeartbeat = [DateTime]::Now.AddSeconds(10)
            }
            return
        }

        $script:UiOperationTimer.Stop()
        $operationProcess.WaitForExit()
        $exitCode = [int] $operationProcess.ExitCode
        $operationSucceeded = ($exitCode -eq 0) -and (-not [bool] $script:UiOperationTimedOut)
        $completedLabel = $script:UiOperationLabel
        $completedMode = $script:UiOperationMode
        if ($completedMode -eq 'Status') {
            $statusOutput = Read-UiOperationText $script:UiOperationOutFile
            $statusError = Read-UiOperationText $script:UiOperationErrFile
        } else {
            $script:UiOperationOutOffset = Read-UiOperationLog $script:UiOperationOutFile $script:UiOperationOutOffset
            $script:UiOperationErrOffset = Read-UiOperationLog $script:UiOperationErrFile $script:UiOperationErrOffset 'ERROR · '
        }
        $operationProcess.Dispose()
        $script:UiOperationProcess = $null

        foreach ($operationLog in @($script:UiOperationOutFile, $script:UiOperationErrFile)) {
            if (Test-Path -LiteralPath $operationLog -PathType Leaf) {
                Remove-Item -LiteralPath $operationLog -Force -ErrorAction SilentlyContinue
            }
        }
        $toolbar.Enabled = $true
        $subtitle.Text = 'Laravel, PostgreSQL, cola, scheduler y Angular desde un único panel.'

        if ($operationSucceeded) {
            if ($completedMode -eq 'Status') {
                $statusBox.Text = if ([string]::IsNullOrWhiteSpace($statusOutput)) { 'El diagnóstico no devolvió información.' } else { $statusOutput }
                Write-UiLog 'Estado actualizado.'
            } else {
                Write-UiLog "$completedLabel completado."
            }
        } else {
            if ($completedMode -eq 'Status') {
                $statusBox.Text = "No se pudo obtener el estado.`r`n$statusError"
            }
            $message = if ($script:UiOperationTimedOut) {
                "$completedLabel superó el tiempo máximo. Revisa el estado actual antes de reintentar."
            } else {
                "$completedLabel no se completó (código $exitCode). Revisa el registro inferior para ver el motivo."
            }
            if ($completedMode -eq 'Status' -and [string]::IsNullOrWhiteSpace($statusError)) {
                $statusBox.Text = "El diagnóstico terminó con código $exitCode sin escribir un error. Pulsa Actualizar estado para reintentar."
            }
            Write-UiLog "ERROR · $message"
            [Windows.Forms.MessageBox]::Show(
                $form,
                $message,
                'UVH · Operación no completada',
                [Windows.Forms.MessageBoxButtons]::OK,
                [Windows.Forms.MessageBoxIcon]::Error
            ) | Out-Null
        }
        if ($completedMode -ne 'Status') {
            Update-UiStatus
        }
    } catch {
        # Exceptions escaping a WinForms event delegate are handled by .NET as
        # unhandled UI-thread failures and trigger the opaque JIT dialog seen
        # by the operator. Recover the controls and retain the useful location
        # and exception type in the local UI log instead.
        $script:UiOperationTimer.Stop()
        $failedProcess = $script:UiOperationProcess
        $script:UiOperationProcess = $null
        if ($null -ne $failedProcess) {
            try { $failedProcess.Dispose() } catch { }
        }
        $toolbar.Enabled = $true
        $subtitle.Text = 'Laravel, PostgreSQL, cola, scheduler y Angular desde un único panel.'
        $diagnostic = "Fallo interno del panel · $($_.InvocationInfo.ScriptLineNumber): $($_.Exception.GetType().Name) · $($_.Exception.Message)"
        # Persist only the diagnostic shape, never child stdout/stderr. This
        # makes timer failures debuggable after the modal closes without
        # copying service output, URLs, credentials or other runtime data.
        try {
            Add-Content -LiteralPath (Join-Path $script:RuntimeDir 'panel-error.log') -Encoding UTF8 -Value "[$([DateTime]::Now.ToString('s'))] $diagnostic"
        } catch { }
        Write-UiLog "ERROR · $diagnostic"
        $statusBox.Text = "No se pudo actualizar el panel.`r`n$diagnostic"
        [Windows.Forms.MessageBox]::Show(
            $form,
            'El panel encontró un error interno y recuperó los controles. Revisa el registro inferior para ver el detalle.',
            'UVH · Error controlado',
            [Windows.Forms.MessageBoxButtons]::OK,
            [Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
})

$startButton.Add_Click({ Invoke-UiOperation 'Iniciando servicios' 'Start' })
$stopButton.Add_Click({ Invoke-UiOperation 'Deteniendo servicios' 'Stop' })
$restartButton.Add_Click({ Invoke-UiOperation 'Reiniciando servicios' 'Restart' })
$refreshButton.Add_Click({ Update-UiStatus })
$migrateButton.Add_Click({
    try {
        $databaseName = Get-LocalDatabaseName
    } catch {
        [Windows.Forms.MessageBox]::Show(
            $form,
            $_.Exception.Message,
            'UVH · Configuración local inválida',
            [Windows.Forms.MessageBoxButtons]::OK,
            [Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
        return
    }
    $answer = [Windows.Forms.MessageBox]::Show(
        $form,
        "Se aplicarán las migraciones pendientes a '$databaseName'. Una migración puede modificar esquema o datos; conserva un backup si esta base importa. ¿Continuar?",
        'UVH · Aplicar migraciones',
        [Windows.Forms.MessageBoxButtons]::YesNo,
        [Windows.Forms.MessageBoxIcon]::Question
    )
    if ($answer -eq [Windows.Forms.DialogResult]::Yes) {
        Invoke-UiOperation 'Aplicando migraciones locales' 'Migrate'
    }
})
$repairDockerButton.Add_Click({
    $answer = [Windows.Forms.MessageBox]::Show(
        $form,
        'Esta reparación cerrará Docker Desktop y la distribución docker-desktop, solicitará UAC y retirará únicamente el socket sailor-ingest dañado. No elimina imágenes, contenedores ni volúmenes. ¿Continuar?',
        'UVH · Reparar Docker',
        [Windows.Forms.MessageBoxButtons]::YesNo,
        [Windows.Forms.MessageBoxIcon]::Warning
    )
    if ($answer -eq [Windows.Forms.DialogResult]::Yes) {
        Invoke-UiOperation 'Reparando Docker Desktop' 'RepairDocker'
    }
})
$dockerLogsButton.Add_Click({
    $scriptArgument = '"' + $script:SelfPath.Replace('"', '""') + '"'
    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', $scriptArgument, '-Mode', 'FollowDockerLogs')
})
$frontendLogsButton.Add_Click({
    $scriptArgument = '"' + $script:SelfPath.Replace('"', '""') + '"'
    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', $scriptArgument, '-Mode', 'FollowFrontendLogs')
})
$openButton.Add_Click({ Start-Process 'http://127.0.0.1:4200/' })

$form.Add_Shown({ Update-UiStatus; Write-UiLog 'Panel preparado. Las pruebas no se ejecutan desde esta herramienta.' })
$form.Add_FormClosing({
    param($sender, $eventArgs)
    if ($null -ne $script:UiOperationProcess -and -not $script:UiOperationProcess.HasExited) {
        # Releasing the single-instance guard while a child still mutates
        # services would allow a second panel to race it. Keep the responsive
        # window open until completion or its bounded timeout.
        $eventArgs.Cancel = $true
        [Windows.Forms.MessageBox]::Show(
            $form,
            'Hay una operación en curso. Espera a que termine antes de cerrar el panel.',
            'UVH · Operación en curso',
            [Windows.Forms.MessageBoxButtons]::OK,
            [Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
    }
})
$form.Add_FormClosed({
    $script:UiOperationTimer.Stop()
    if ($script:GuiMutexOwned) {
        try { $script:GuiMutex.ReleaseMutex() } catch { }
    }
    $script:GuiMutex.Dispose()
})
[void] $form.ShowDialog()
