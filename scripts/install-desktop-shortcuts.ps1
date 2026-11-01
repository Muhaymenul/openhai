param(
  [string]$DestinationDirectory = [Environment]::GetFolderPath('DesktopDirectory'),
  [switch]$NonInteractive,
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$launcher = Join-Path $PSScriptRoot 'desktop-launch.ps1'
$engine = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$icon = Join-Path $projectRoot 'app\src\app\favicon.ico'
$destination = [IO.Path]::GetFullPath($DestinationDirectory)
$definitions = @(
  @{ name = '打开教研阅记（openhai）'; action = 'start'; description = '教研阅记 openhai：打开本机论文阅读工作区' },
  @{ name = '关闭教研阅记（openhai）'; action = 'stop'; description = '教研阅记 openhai：关闭本项目后台，保留论文和笔记' }
)

try {
  if (!(Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'The desktop launcher is missing.' }
  if (!(Test-Path -LiteralPath $engine -PathType Leaf)) { throw 'Windows PowerShell is unavailable.' }
  if ($ValidateOnly) {
    $definitions | ForEach-Object {
      [pscustomobject]@{ name = $_.name; path = Join-Path $destination ($_.name + '.lnk'); target = $engine; arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '" -Action ' + $_.action; workingDirectory = $projectRoot; windowStyle = 'Hidden' }
    } | ConvertTo-Json -Depth 3
    exit 0
  }
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  try {
    # Inspect both names before writing either shortcut. Never replace an unrelated link.
    foreach ($definition in $definitions) {
      $shortcutPath = Join-Path $destination ($definition.name + '.lnk')
      if (Test-Path -LiteralPath $shortcutPath) {
        $existing = $shell.CreateShortcut($shortcutPath)
        try {
          if ($existing.Description -notlike '教研阅记 openhai：*' -and $existing.Arguments -notlike ('*' + $launcher + '*')) { throw ('已有同名快捷方式，未覆盖：' + $shortcutPath) }
        } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($existing) }
      }
    }
    foreach ($definition in $definitions) {
      $shortcutPath = Join-Path $destination ($definition.name + '.lnk')
      $shortcut = $shell.CreateShortcut($shortcutPath)
      try {
        $shortcut.TargetPath = $engine
        $shortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '" -Action ' + $definition.action
        $shortcut.WorkingDirectory = $projectRoot
        $shortcut.Description = $definition.description
        $shortcut.WindowStyle = 7
        if (Test-Path -LiteralPath $icon -PathType Leaf) { $shortcut.IconLocation = $icon + ',0' }
        $shortcut.Save()
        [Console]::Out.WriteLine('已创建：' + $shortcutPath)
      } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) }
    }
  } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
} catch {
  $message = '快捷方式未安装完成：' + $_.Exception.Message
  [Console]::Error.WriteLine($message)
  if (!$NonInteractive) {
    try {
      Add-Type -AssemblyName System.Windows.Forms
      [void][System.Windows.Forms.MessageBox]::Show($message, '教研阅记', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
    } catch { }
  }
  exit 1
}
exit 0
