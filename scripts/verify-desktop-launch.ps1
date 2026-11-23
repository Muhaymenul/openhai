param([switch]$KeepArtifacts)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$temporaryRoot = Join-Path $projectRoot 'tmp'
$testRoot = Join-Path $temporaryRoot ('desktop-launch-smoke-' + [Guid]::NewGuid().ToString('N'))
$engine = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$launcherSource = Join-Path $PSScriptRoot 'desktop-launch.ps1'
$installerSource = Join-Path $PSScriptRoot 'install-desktop-shortcuts.ps1'
$checks = [Collections.Generic.List[string]]::new()
$fixtureChildRecords = [Collections.Generic.List[string]]::new()

function Assert-Check([bool]$Condition, [string]$Description) {
  if (!$Condition) { throw ('Check failed: ' + $Description) }
  $checks.Add($Description)
}

function Invoke-TestScript([string]$ScriptPath, [string[]]$ScriptArguments, [string]$CaptureName, [int]$TimeoutMilliseconds = 15000) {
  $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $ScriptPath + '"')) + $ScriptArguments
  $process = Start-Process -FilePath $engine -ArgumentList $arguments -WorkingDirectory $testRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $testRoot ($CaptureName + '.stdout.txt')) -RedirectStandardError (Join-Path $testRoot ($CaptureName + '.stderr.txt')) -PassThru
  try {
    # Cache the process handle before a fast worker exits, then wait only for
    # that worker: Start-Process -Wait would also wait for its descendants.
    $null = $process.Handle
    if (!$process.WaitForExit($TimeoutMilliseconds)) {
      if (!$process.HasExited) { $process.Kill(); [void]$process.WaitForExit(5000) }
      throw ('Isolated test worker exceeded ' + $TimeoutMilliseconds + ' milliseconds: ' + $CaptureName)
    }
    return $process.ExitCode
  } finally { $process.Dispose() }
}

function New-MockProject([string]$Name, [string]$ReadyBody, [int]$ManagerExit = 0) {
  $fixture = Join-Path $testRoot $Name
  $scripts = Join-Path $fixture 'scripts'
  New-Item -ItemType Directory -Path $scripts -Force | Out-Null
  $content = [IO.File]::ReadAllText($launcherSource)
  $tokens = $null
  $errors = $null
  $ast = [Management.Automation.Language.Parser]::ParseInput($content, [ref]$tokens, [ref]$errors)
  $readyFunction = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-WorkspaceReady' }, $false)
  if (!$readyFunction) { throw 'Unable to isolate the readiness probe.' }
  $content = $content.Remove($readyFunction.Extent.StartOffset, $readyFunction.Extent.EndOffset - $readyFunction.Extent.StartOffset).Insert($readyFunction.Extent.StartOffset, ('function Test-WorkspaceReady { ' + $ReadyBody + ' }'))
  $launcher = Join-Path $scripts 'desktop-launch.ps1'
  [IO.File]::WriteAllText($launcher, $content, [Text.UTF8Encoding]::new($true))
  $manager = @'
param([string]$Action, [switch]$NoBrowser)
[IO.File]::AppendAllText((Join-Path $PSScriptRoot 'manager-calls.txt'), ($Action + ' NoBrowser=' + $NoBrowser.IsPresent + [Environment]::NewLine))
Write-Output 'Mock project operation completed.'
exit EXIT_CODE
'@
  [IO.File]::WriteAllText((Join-Path $scripts 'manage.ps1'), $manager.Replace('EXIT_CODE', [string]$ManagerExit), [Text.UTF8Encoding]::new($true))
  return $launcher
}

function New-ManagerFixture([string]$Name, [bool]$DockerReady, [string]$Endpoint) {
  $fixture = Join-Path $testRoot $Name
  $scripts = Join-Path $fixture 'scripts'
  New-Item -ItemType Directory -Path $scripts -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'manage.ps1') -Destination (Join-Path $scripts 'manage.ps1')
  $fakeDocker = @'
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$DockerArguments)
if ($DockerArguments[0] -eq 'info') { exit MOCK_READY }
if ($DockerArguments[0] -eq 'context') { Write-Output 'MOCK_ENDPOINT'; exit 0 }
if ($DockerArguments[0] -eq 'compose') {
  [IO.File]::AppendAllText((Join-Path $PSScriptRoot 'compose-calls.txt'), (($DockerArguments -join ' ') + [Environment]::NewLine))
  exit 0
}
throw 'Unexpected isolated Docker command.'
'@
  $readyExit = if ($DockerReady) { '0' } else { '1' }
  [IO.File]::WriteAllText((Join-Path $scripts 'fake-docker.ps1'), $fakeDocker.Replace('MOCK_READY', $readyExit).Replace('MOCK_ENDPOINT', $Endpoint), [Text.UTF8Encoding]::new($true))
  $runner = @'
function Get-Command {
  [CmdletBinding()]param([string]$Name)
  if ($Name -ne 'docker') { throw 'Unexpected command lookup.' }
  return [pscustomobject]@{Source=(Join-Path $PSScriptRoot 'fake-docker.ps1')}
}
function Start-Process { throw 'The stop action must not start any process.' }
function Start-Sleep { throw 'The stop action must not wait for Docker.' }
& (Join-Path $PSScriptRoot 'manage.ps1') -Action stop -NoBrowser
'@
  $runnerPath = Join-Path $scripts 'verify-manager.ps1'
  [IO.File]::WriteAllText($runnerPath, $runner, [Text.UTF8Encoding]::new($true))
  return $runnerPath
}

function New-PersistentChildFixture([string]$Name) {
  $launcher = New-MockProject $Name "return (Test-Path -LiteralPath (Join-Path `$PSScriptRoot 'ready.flag'))"
  $scripts = Split-Path $launcher -Parent
  $recordPath = Join-Path $scripts 'persistent-child.json'
  $fixtureChildRecords.Add($recordPath)
  [IO.File]::WriteAllText((Join-Path $scripts 'persistent-child.ps1'), 'Start-Sleep -Seconds 60', [Text.UTF8Encoding]::new($true))
  $manager = @'
param([string]$Action, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
[IO.File]::AppendAllText((Join-Path $PSScriptRoot 'manager-calls.txt'), ($Action + ' NoBrowser=' + $NoBrowser.IsPresent + [Environment]::NewLine))
$engine = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$childScript = Join-Path $PSScriptRoot 'persistent-child.ps1'
$child = Start-Process -FilePath $engine -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $childScript + '"')) -WindowStyle Hidden -PassThru
try {
  $null = $child.Handle
  $identity = [pscustomobject]@{ ProcessId = $child.Id; ProcessName = $child.ProcessName; StartTimeUtcTicks = $child.StartTime.ToUniversalTime().Ticks; Fixture = $PSScriptRoot }
  [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'persistent-child.json'), ($identity | ConvertTo-Json), [Text.UTF8Encoding]::new($true))
} finally { $child.Dispose() }
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'ready.flag'), 'ready')
Write-Output 'Mock manager completed while its isolated descendant remains running.'
exit 0
'@
  [IO.File]::WriteAllText((Join-Path $scripts 'manage.ps1'), $manager, [Text.UTF8Encoding]::new($true))
  return $launcher
}

function Stop-FixtureChildren {
  $allowed = [IO.Path]::GetFullPath($testRoot).TrimEnd('\') + '\'
  foreach ($recordPath in $fixtureChildRecords) {
    $resolved = [IO.Path]::GetFullPath($recordPath)
    if (!$resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test child record path.' }
    if (!(Test-Path -LiteralPath $resolved -PathType Leaf)) { continue }
    $identity = [IO.File]::ReadAllText($resolved) | ConvertFrom-Json
    if ([IO.Path]::GetFullPath([string]$identity.Fixture) -ne (Split-Path $resolved -Parent)) { throw 'Test child record has the wrong fixture.' }
    $child = Get-Process -Id ([int]$identity.ProcessId) -ErrorAction SilentlyContinue
    if (!$child) { continue }
    try {
      if ($child.ProcessName -ne 'powershell' -or $child.ProcessName -ne $identity.ProcessName -or $child.StartTime.ToUniversalTime().Ticks -ne [long]$identity.StartTimeUtcTicks) {
        throw 'Test child identity changed; refusing to terminate a reused process ID.'
      }
      $child.Kill()
      if (!$child.WaitForExit(5000)) { throw 'The isolated test child did not stop.' }
    } finally { $child.Dispose() }
  }
}

try {
  New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
  foreach ($path in @($launcherSource, $installerSource)) {
    $tokens = $null
    $errors = $null
    [void][Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
    Assert-Check (@($errors).Count -eq 0) ((Split-Path $path -Leaf) + ' parses in Windows PowerShell')
    $bytes = [IO.File]::ReadAllBytes($path)
    Assert-Check ($bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) ((Split-Path $path -Leaf) + ' preserves Chinese text with UTF-8 BOM')
  }

  # Each worker below receives an isolated fake manager and a fake readiness probe.
  # None can reach the actual project manager, Docker, HTTP endpoint, or browser.
  $stopLauncher = New-MockProject 'stop project with spaces' 'return $false'
  Assert-Check ((Invoke-TestScript $stopLauncher @('-Action', 'stop', '-NoBrowser', '-NonInteractive') 'stop') -eq 0) 'stop completes with an isolated manager'
  $stopCalls = [IO.File]::ReadAllText((Join-Path (Split-Path $stopLauncher) 'manager-calls.txt'))
  Assert-Check ($stopCalls.Trim() -eq 'stop NoBrowser=True') 'stop forwards only this project action and disables manager browser'

  $readyLauncher = New-MockProject 'already ready' 'return $true'
  Assert-Check ((Invoke-TestScript $readyLauncher @('-Action', 'start', '-NoBrowser', '-NonInteractive') 'ready') -eq 0) 'ready workspace opens without restarting services'
  Assert-Check (!(Test-Path -LiteralPath (Join-Path (Split-Path $readyLauncher) 'manager-calls.txt'))) 'ready workspace never calls the manager'

  $startLauncher = New-MockProject 'cold start' '$script:probeCount += 1; return ($script:probeCount -gt 1)'
  Assert-Check ((Invoke-TestScript $startLauncher @('-Action', 'start', '-NoBrowser', '-NonInteractive') 'start') -eq 0) 'start waits for the manager and verifies readiness'
  $startCalls = [IO.File]::ReadAllText((Join-Path (Split-Path $startLauncher) 'manager-calls.txt'))
  Assert-Check ($startCalls.Trim() -eq 'start NoBrowser=True') 'start forwards one manager operation'

  $failureLauncher = New-MockProject 'failed stop' 'return $false' 7
  Assert-Check ((Invoke-TestScript $failureLauncher @('-Action', 'stop', '-NoBrowser', '-NonInteractive') 'failure') -eq 1) 'manager failure returns a nonzero exit code without showing a dialog'
  $failureLogs = @(Get-ChildItem -LiteralPath (Join-Path (Split-Path (Split-Path $failureLauncher)) 'runtime\launcher') -Filter '*.log' -File)
  Assert-Check ($failureLogs.Count -eq 1 -and [IO.File]::ReadAllText($failureLogs[0].FullName).Contains('exit code 7')) 'failure is recorded in a project-local log'

  $unreadyLauncher = New-MockProject 'unready start' 'return $false'
  Assert-Check ((Invoke-TestScript $unreadyLauncher @('-Action', 'start', '-NoBrowser', '-NonInteractive') 'unready') -eq 1) 'a successful manager alone cannot claim the app is ready'

  # Run the actual manager's stop logic against a fake Docker script only.
  $offlineManager = New-ManagerFixture 'offline Docker manager' $false 'npipe:////./pipe/docker_engine'
  Assert-Check ((Invoke-TestScript $offlineManager @() 'offline-manager') -eq 0) 'stop succeeds immediately when Docker is offline without starting it'
  Assert-Check (!(Test-Path -LiteralPath (Join-Path (Split-Path $offlineManager) 'compose-calls.txt'))) 'offline stop does not run Compose'
  $localManager = New-ManagerFixture 'local Docker manager' $true 'npipe:////./pipe/docker_engine'
  Assert-Check ((Invoke-TestScript $localManager @() 'local-manager') -eq 0) 'stop accepts an available local Docker engine'
  $composeCalls = [IO.File]::ReadAllText((Join-Path (Split-Path $localManager) 'compose-calls.txt'))
  Assert-Check ($composeCalls.Trim() -eq 'compose stop') 'local stop invokes only this project Compose stop'
  $remoteManager = New-ManagerFixture 'remote Docker manager' $true 'tcp://example.invalid:2376'
  Assert-Check ((Invoke-TestScript $remoteManager @() 'remote-manager') -eq 1) 'stop still rejects a remote Docker context'
  Assert-Check (!(Test-Path -LiteralPath (Join-Path (Split-Path $remoteManager) 'compose-calls.txt'))) 'rejected remote context receives no Compose operation'

  $shortcuts = Join-Path $testRoot 'shortcuts'
  $installerArguments = @('-DestinationDirectory', ('"' + $shortcuts + '"'), '-NonInteractive')
  Assert-Check ((Invoke-TestScript $installerSource $installerArguments 'install') -eq 0) 'shortcuts install into an isolated directory'
  Assert-Check ((Invoke-TestScript $installerSource $installerArguments 'reinstall') -eq 0) 'reinstall safely updates this application shortcuts'
  $links = @(Get-ChildItem -LiteralPath $shortcuts -Filter '*.lnk' -File)
  Assert-Check ($links.Count -eq 2) 'installer creates exactly two shortcuts'
  $shell = New-Object -ComObject WScript.Shell
  try {
    foreach ($link in $links) {
      $shortcut = $shell.CreateShortcut($link.FullName)
      try {
        Assert-Check ($shortcut.TargetPath -eq $engine -and $shortcut.Arguments.Contains('-WindowStyle Hidden') -and $shortcut.Arguments.Contains($launcherSource)) ($link.Name + ' uses the hidden Windows launcher')
        Assert-Check ($shortcut.WorkingDirectory.TrimEnd('\') -eq $projectRoot.TrimEnd('\')) ($link.Name + ' resolves the correct project folder')
      } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) }
    }
    $foreign = $shell.CreateShortcut($links[0].FullName)
    try {
      $foreign.TargetPath = $engine
      $foreign.Arguments = '-NoProfile'
      $foreign.Description = 'Unrelated shortcut'
      $foreign.Save()
    } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($foreign) }
    $beforeHash = (Get-FileHash -LiteralPath $links[0].FullName -Algorithm SHA256).Hash
    Assert-Check ((Invoke-TestScript $installerSource $installerArguments 'foreign') -eq 1) 'installer rejects an unrelated shortcut with the same name'
    Assert-Check ((Get-FileHash -LiteralPath $links[0].FullName -Algorithm SHA256).Hash -eq $beforeHash) 'rejected shortcut remains untouched'
  } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
  # A cold manager may launch a long-lived Docker Desktop process and then
  # finish. This isolated sleeper reproduces that process tree without Docker.
  $persistentLauncher = New-PersistentChildFixture 'manager with persistent descendant'
  $persistentScripts = Split-Path $persistentLauncher -Parent
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $persistentExit = Invoke-TestScript $persistentLauncher @('-Action', 'start', '-NoBrowser', '-NonInteractive') 'persistent-manager'
  $timer.Stop()
  Assert-Check ($persistentExit -eq 0 -and $timer.ElapsedMilliseconds -lt 15000) 'cold start completes within 15 seconds while the manager descendant remains alive'
  $identity = [IO.File]::ReadAllText((Join-Path $persistentScripts 'persistent-child.json')) | ConvertFrom-Json
  $persistentChild = Get-Process -Id ([int]$identity.ProcessId) -ErrorAction SilentlyContinue
  try {
    Assert-Check ($null -ne $persistentChild -and $persistentChild.ProcessName -eq $identity.ProcessName -and $persistentChild.StartTime.ToUniversalTime().Ticks -eq [long]$identity.StartTimeUtcTicks) 'cold start waits for the manager itself rather than its persistent child'
  } finally { if ($persistentChild) { $persistentChild.Dispose() } }
  $persistentLogDirectory = Join-Path (Split-Path $persistentScripts -Parent) 'runtime\launcher'
  $persistentLogs = @(Get-ChildItem -LiteralPath $persistentLogDirectory -Filter '*.log' -File)
  Assert-Check ($persistentLogs.Count -eq 1 -and [IO.File]::ReadAllText($persistentLogs[0].FullName).Contains('Completed successfully.')) 'cold start records completion before its persistent child exits'
  $timer.Restart()
  $repeatExit = Invoke-TestScript $persistentLauncher @('-Action', 'start', '-NoBrowser', '-NonInteractive') 'persistent-manager-repeat'
  $timer.Stop()
  Assert-Check ($repeatExit -eq 0 -and $timer.ElapsedMilliseconds -lt 15000) 'a second click obtains the same project mutex within 15 seconds'
  $persistentCalls = @([IO.File]::ReadAllLines((Join-Path $persistentScripts 'manager-calls.txt')))
  Assert-Check ($persistentCalls.Count -eq 1 -and $persistentCalls[0] -eq 'start NoBrowser=True') 'the second ready launch does not run the cold manager again'
  $persistentLogs = @(Get-ChildItem -LiteralPath $persistentLogDirectory -Filter '*.log' -File)
  $readyLog = @($persistentLogs | Where-Object { [IO.File]::ReadAllText($_.FullName).Contains('The workspace is already ready.') -and [IO.File]::ReadAllText($_.FullName).Contains('Completed successfully.') })
  Assert-Check ($persistentLogs.Count -eq 2 -and $readyLog.Count -eq 1) 'the second launch records the ready fast path and completes successfully'
  [pscustomobject]@{ passed = $checks.Count; checks = $checks.ToArray(); realServicesTouched = $false; desktopTouched = $false } | ConvertTo-Json -Depth 4
} finally {
  Stop-FixtureChildren
  if ($KeepArtifacts) { [Console]::Out.WriteLine('Artifacts: ' + $testRoot) }
  elseif (Test-Path -LiteralPath $testRoot) {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $allowed = [IO.Path]::GetFullPath($temporaryRoot).TrimEnd('\') + '\'
    if (!$resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase) -or !(Split-Path $resolved -Leaf).StartsWith('desktop-launch-smoke-')) { throw 'Unsafe test cleanup path.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
