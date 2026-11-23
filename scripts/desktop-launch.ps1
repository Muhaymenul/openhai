param(
  [ValidateSet('start', 'stop')][string]$Action = 'start',
  [switch]$NoBrowser,
  [switch]$NonInteractive,
  [switch]$Background,
  [switch]$WaitForManager,
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manageScript = Join-Path $PSScriptRoot 'manage.ps1'
$engine = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$workspaceUrl = 'http://127.0.0.1:3000/workspace'
$logDirectory = Join-Path $projectRoot 'runtime\launcher'

function Get-LauncherArguments([string]$ScriptPath) {
  $arguments = @('-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $ScriptPath + '"'), '-Action', $Action)
  if ($NoBrowser) { $arguments += '-NoBrowser' }
  if ($NonInteractive) { $arguments += '-NonInteractive' }
  if ($WaitForManager) { $arguments += '-WaitForManager' }
  return $arguments
}

function Test-WorkspaceReady {
  try {
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/research' -UseBasicParsing -TimeoutSec 3
    if ($response.StatusCode -ne 200) { return $false }
    $payload = $response.Content | ConvertFrom-Json
    return ($null -ne $payload -and $payload.PSObject.Properties.Name -contains 'papers' -and $payload.PSObject.Properties.Name -contains 'notes' -and $payload.PSObject.Properties.Name -contains 'graph')
  } catch { return $false }
}

function Write-LauncherLog([string]$Message) {
  $line = [DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss') + ' ' + $Message + [Environment]::NewLine
  [IO.File]::AppendAllText($script:logFile, $line, [Text.UTF8Encoding]::new($true))
}

function Show-LauncherFailure([string]$Message) {
  if ($NonInteractive) { return }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($Message, '教研阅记', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
  } catch { [Console]::Error.WriteLine($Message) }
}

if ($ValidateOnly) {
  [pscustomobject]@{
    action = $Action
    projectRoot = $projectRoot
    manager = $manageScript
    launcher = $PSCommandPath
    engine = $engine
    engineExists = Test-Path -LiteralPath $engine -PathType Leaf
    managerExists = Test-Path -LiteralPath $manageScript -PathType Leaf
    windowStyle = 'Hidden'
    url = $workspaceUrl
    logDirectory = $logDirectory
  } | ConvertTo-Json -Depth 3
  exit 0
}

if ($Background) {
  try {
    if (!(Test-Path -LiteralPath $engine -PathType Leaf)) { throw 'Windows PowerShell is unavailable.' }
    Start-Process -FilePath $engine -ArgumentList (Get-LauncherArguments $PSCommandPath) -WorkingDirectory $projectRoot -WindowStyle Hidden | Out-Null
    exit 0
  } catch {
    Show-LauncherFailure '启动器无法打开，请运行项目文件夹中的“检查Demo.cmd”查看状态。'
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
  }
}

$mutex = $null
$acquired = $false
$exitCode = 0
$logFile = Join-Path $logDirectory ('launcher-' + [DateTime]::Now.ToString('yyyyMMdd-HHmmss') + '-' + $Action + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '.log')
try {
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  if (!(Test-Path -LiteralPath $engine -PathType Leaf)) { throw 'Windows PowerShell is unavailable.' }
  if (!(Test-Path -LiteralPath $manageScript -PathType Leaf)) { throw 'The project manager script is missing.' }
  $hash = [Security.Cryptography.SHA256]::Create()
  try { $projectKey = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant()))).Replace('-', '').Substring(0, 24) }
  finally { $hash.Dispose() }
  $mutex = [Threading.Mutex]::new($false, ('Local\JiaoyanLauncher-' + $projectKey))
  try { $acquired = $mutex.WaitOne(120000) }
  catch [Threading.AbandonedMutexException] { $acquired = $true }
  if (!$acquired) { throw 'The previous launch operation is still running. Please retry shortly.' }
  Write-LauncherLog ('Action: ' + $Action)

  if ($Action -eq 'start' -and !$WaitForManager -and !(Test-Path -LiteralPath (Join-Path $projectRoot '.portable-project.json')) -and (Test-WorkspaceReady)) {
    Write-LauncherLog 'The workspace is already ready. No Docker operation was required.'
  } else {
    $outputFile = $logFile + '.output.txt'
    $errorFile = $logFile + '.error.txt'
    $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $manageScript + '"'), '-Action', $Action, '-NoBrowser')
    $operation = Start-Process -FilePath $engine -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $outputFile -RedirectStandardError $errorFile -PassThru
    try {
      # Docker Desktop remains running after the manager exits. Wait only for
      # the manager, rather than its complete process tree or inherited output.
      $null = $operation.Handle
      $deadline = [DateTime]::UtcNow.AddMinutes(5)
      while (!$operation.WaitForExit(500)) {
        if ([DateTime]::UtcNow -ge $deadline) {
          if (!$WaitForManager) { throw 'The project manager did not finish within five minutes.' }
          Write-LauncherLog 'The manager is still active. Keeping the operation lock until it finishes.'
          $deadline=[DateTime]::UtcNow.AddMinutes(5)
        }
      }
      $managerExitCode = $operation.ExitCode
    } finally { $operation.Dispose() }
    foreach ($capture in @($outputFile, $errorFile)) {
      if (Test-Path -LiteralPath $capture -PathType Leaf) {
        $content = [IO.File]::ReadAllText($capture)
        if ($content.Trim()) { Write-LauncherLog $content.Trim() }
      }
    }
    if ($managerExitCode -ne 0) { throw ('The project manager returned exit code ' + $managerExitCode + '.') }
    if ($Action -eq 'start' -and !(Test-WorkspaceReady)) { throw 'The workspace did not respond after startup.' }
  }

  if ($Action -eq 'start' -and !$NoBrowser) {
    # Opening the browser is the requested interactive output, not a background helper.
    Start-Process -FilePath $workspaceUrl | Out-Null
  }
  Write-LauncherLog 'Completed successfully. Project data was preserved.'
  if ($NonInteractive) { [Console]::Out.WriteLine('Completed: ' + $Action + '. Log: ' + $logFile) }
} catch {
  $exitCode = 1
  try { Write-LauncherLog $_.Exception.ToString() } catch { }
  $verb = if ($Action -eq 'start') { '打开' } else { '关闭' }
  $message = '暂时无法' + $verb + '教研阅记。论文和笔记已保留。' + [Environment]::NewLine + [Environment]::NewLine + '请查看日志：' + [Environment]::NewLine + $logFile
  Show-LauncherFailure $message
  [Console]::Error.WriteLine($message)
} finally {
  if ($acquired -and $mutex) { $mutex.ReleaseMutex() }
  if ($mutex) { $mutex.Dispose() }
}
exit $exitCode
