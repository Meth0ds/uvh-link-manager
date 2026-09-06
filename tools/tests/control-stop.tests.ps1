Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Load only the relevant function definitions: never run the panel entrypoint,
# Docker, process termination or migrations from this regression check.
$source = Join-Path $PSScriptRoot '..\uvh-control.ps1'
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile(
    $source, [ref] $tokens, [ref] $parseErrors)
if ($parseErrors.Count -ne 0) { throw 'Control script contains syntax errors.' }
foreach ($name in @('Invoke-UvhCompose', 'Stop-UvhLocal')) {
    $definition = $ast.Find({ param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
    }, $true)
    . ([scriptblock]::Create($definition.Extent.Text))
}

function Initialize-LocalEnvironment { }
function Stop-Frontend { 'Frontend detenido.' }
function Get-Command { [pscustomobject]@{ Source = 'fake-docker' } }
function Invoke-NativeCommand {
    [pscustomobject]@{ ExitCode = $script:FakeExitCode; Output = $script:FakeOutput }
}
function Start-UvhLocal { $script:StartCalls++ }
$script:ComposeFile = 'unused-compose.yml'
$script:EnvFile = 'unused.env'

$script:FakeExitCode = 1
$script:FakeOutput = 'simulated compose stop failure'
$caught = $false
try { Stop-UvhLocal | Out-Null } catch {
    $caught = $_.Exception.Message -eq $script:FakeOutput
}
if (-not $caught) { throw 'A failed Compose stop was reported as successful.' }

# Exercise the actual CLI dispatch, not a duplicate of the restart sequence.
$dispatch = $ast.Find({ param($node)
    $node -is [Management.Automation.Language.AssignmentStatementAst] -and
        $node.Left.Extent.Text -eq '$commandOutput'
}, $true)
$Mode = 'Restart'
$script:StartCalls = 0
try { . ([scriptblock]::Create($dispatch.Extent.Text)) } catch { }
if ($script:StartCalls -ne 0) { throw 'Restart started services after a failed stop.' }

$script:FakeExitCode = 0
$script:FakeOutput = 'Compose detenido.'
$result = Stop-UvhLocal
if ($result -notmatch 'Frontend detenido' -or $result -notmatch 'Compose detenido') {
    throw 'Successful stop lost its component diagnostics.'
}
. ([scriptblock]::Create($dispatch.Extent.Text))
if ($script:StartCalls -ne 1) { throw 'Successful restart did not start services exactly once.' }
Write-Output 'PASS: failed stop, aborted restart, successful stop and successful restart (4 checks).'
