$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$desktopExe=Join-Path $projectRoot 'desktop\node_modules\electron\dist\electron.exe'
$open=@(Get-Process -Name electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $desktopExe -and $_.MainWindowHandle -ne 0 })
if($open.Count) { Write-Host '请先保存内容并关闭教研阅记桌面窗口，再运行“准备拔盘.cmd”。'; exit 1 }
& (Join-Path $PSScriptRoot 'manage.ps1') -Action stop -NoBrowser
if (Test-Path -LiteralPath (Join-Path $projectRoot '.portable-project.json')) { Write-Host 'This project backend and its portable database are stopped.' } else { Write-Host 'This project backend is stopped. The system PostgreSQL service remains running.' }
