param(
  [ValidateSet('Setup','Start','Test','Smoke','Check')][string]$Action='Start',
  [switch]$Background
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$desktopRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$projectRoot=[IO.Path]::GetFullPath((Join-Path $desktopRoot '..'))
$tools=Join-Path $desktopRoot '.tools'
$cache=Join-Path $desktopRoot '.cache'
$local=Join-Path $desktopRoot '.local'
$nodeVersion='v24.22.3'
$nodeDirectory=Join-Path $tools ('node-'+$nodeVersion+'-win-x64')
$node=Join-Path $nodeDirectory 'node.exe'
$npm=Join-Path $nodeDirectory 'node_modules\npm\bin\npm-cli.js'
$electron=Join-Path $desktopRoot 'node_modules\electron\dist\electron.exe'
$engine=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
foreach ($relative in @('.cache\npm','.cache\electron','.cache\tmp','.local\tmp','.local\logs')) {
  New-Item -ItemType Directory -Path (Join-Path $desktopRoot $relative) -Force | Out-Null
}
$env:TEMP=Join-Path $cache 'tmp'
$env:TMP=$env:TEMP
$env:npm_config_cache=Join-Path $cache 'npm'
$env:ELECTRON_CACHE=Join-Path $cache 'electron'
$env:ELECTRON_BUILDER_CACHE=Join-Path $cache 'builder'
# A parent developer terminal may have set this to run Electron as Node.
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Set-Location -LiteralPath $desktopRoot

function Install-Node {
  if ((Test-Path -LiteralPath $node) -and (Test-Path -LiteralPath $npm)) { return }
  Write-Host 'Downloading portable Node.js into this desktop folder...'
  $name='node-'+$nodeVersion+'-win-x64.zip'
  $archive=Join-Path $cache $name
  Invoke-WebRequest -UseBasicParsing -Uri ('https://nodejs.org/dist/'+$nodeVersion+'/'+$name) -OutFile $archive
  $expected='e612af99f626ab415ea225af6bce5c971feb448cb5cae250bb1c3fa50c5f7d9f'
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Portable Node.js checksum mismatch.' }
  New-Item -ItemType Directory -Path $tools -Force | Out-Null
  Expand-Archive -LiteralPath $archive -DestinationPath $tools -Force
  Remove-Item -LiteralPath $archive -Force
}

if ($Background) {
  if ($Action -ne 'Start') { throw 'Background mode is only supported for Start.' }
  if (!(Test-Path -LiteralPath $electron)) { throw 'Run setup.cmd in the desktop folder first.' }
  Start-Process -FilePath $engine -ArgumentList @('-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-Action','Start') -WorkingDirectory $desktopRoot -WindowStyle Hidden | Out-Null
  exit 0
}

switch ($Action) {
  'Setup' {
    Install-Node
    $env:PATH=$nodeDirectory+';'+$env:PATH
    $installAction=if (Test-Path -LiteralPath (Join-Path $desktopRoot 'package-lock.json')) { 'ci' } else { 'install' }
    & $node $npm $installAction --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Electron dependency installation failed.' }
    if (!(Test-Path -LiteralPath $electron)) {
      # Use PowerShell's Windows networking for the official GitHub download.
      # This also works where Node's fetch cannot use the local network route.
      $packageRoot=Join-Path $desktopRoot 'node_modules\electron'
      $electronVersion=(Get-Content -LiteralPath (Join-Path $packageRoot 'package.json') -Raw | ConvertFrom-Json).version
      $name='electron-v'+$electronVersion+'-win32-x64.zip'
      $checksums=Get-Content -LiteralPath (Join-Path $packageRoot 'checksums.json') -Raw | ConvertFrom-Json
      $expected=$checksums.$name
      if (!$expected) { throw 'Official Electron checksum is missing.' }
      $archive=Join-Path $cache $name
      Write-Host 'Downloading the official Electron runtime into the project cache...'
      Invoke-WebRequest -UseBasicParsing -Uri ('https://github.com/electron/electron/releases/download/v'+$electronVersion+'/'+$name) -OutFile $archive
      if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Electron checksum mismatch.' }
      Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $packageRoot 'dist') -Force
      [IO.File]::WriteAllText((Join-Path $packageRoot 'path.txt'),'electron.exe',[Text.UTF8Encoding]::new($false))
      Remove-Item -LiteralPath $archive -Force
    }
    & $node (Join-Path $desktopRoot 'node_modules\electron\cli.js') --version
    if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $electron)) { throw 'Electron runtime download failed.' }
    Write-Host 'Desktop setup complete. Double-click launch.cmd.'
  }
  'Start' {
    if (!(Test-Path -LiteralPath $electron)) { throw 'Run setup.cmd first.' }
    # This is the requested visible desktop application, not a background helper.
    Start-Process -FilePath $electron -ArgumentList ('"'+$desktopRoot+'"') -WorkingDirectory $desktopRoot -WindowStyle Normal | Out-Null
  }
  'Test' {
    if (!(Test-Path -LiteralPath $node)) { throw 'Run setup.cmd first.' }
    $testFiles=@(Get-ChildItem -LiteralPath (Join-Path $desktopRoot 'tests') -Filter '*.test.cjs' | ForEach-Object { $_.FullName })
    & $node --test @testFiles
    if ($LASTEXITCODE -ne 0) { throw 'Desktop checks failed.' }
  }
  'Smoke' {
    if (!(Test-Path -LiteralPath $electron)) { throw 'Run setup.cmd first.' }
    $report=Join-Path $local 'qa\smoke.json'
    if (Test-Path -LiteralPath $report) { Remove-Item -LiteralPath $report -Force }
    $process=Start-Process -FilePath $electron -ArgumentList @(('"'+$desktopRoot+'"'),'--desktop-smoke') -WorkingDirectory $desktopRoot -WindowStyle Normal -PassThru
    try {
      if (!$process.WaitForExit(540000)) { throw 'Smoke test timed out; check the desktop window.' }
    } finally { $process.Dispose() }
    if (!(Test-Path -LiteralPath $report)) { throw 'No smoke report. Close an existing desktop window and retry.' }
    $result=Get-Content -LiteralPath $report -Raw -Encoding UTF8 | ConvertFrom-Json
    if (!$result.ok) { throw ('Desktop verification failed: '+$result.error) }
    if (Test-Path -LiteralPath (Join-Path $projectRoot 'docker-compose.yml')) {
      $exitStatus=Get-Content -LiteralPath (Join-Path $local 'logs\exit-status.json') -Raw -Encoding UTF8 | ConvertFrom-Json
      if($exitStatus.phase -ne 'stopped') { throw 'The desktop rendered, but automatic backend shutdown did not finish.' }
    }
    Write-Host ('Desktop rendering passed. Report: '+$report)
  }
  'Check' {
    [pscustomobject]@{
      desktopRoot=$desktopRoot; projectRoot=$projectRoot
      nodeReady=(Test-Path -LiteralPath $node);electronReady=(Test-Path -LiteralPath $electron)
      backendLauncher=(Test-Path -LiteralPath (Join-Path $projectRoot 'scripts\desktop-launch.ps1'))
      runtime=(Join-Path $desktopRoot '.local'); cache=$cache
      workspace='http://127.0.0.1:3000/workspace'
    } | ConvertTo-Json
  }
}
