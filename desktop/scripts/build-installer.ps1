param([switch]$SkipInstall)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$desktopRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nodeDirectory=Join-Path $desktopRoot '.tools\node-v24.22.3-win-x64'
$node=Join-Path $nodeDirectory 'node.exe'
$npm=Join-Path $nodeDirectory 'node_modules\npm\bin\npm-cli.js'
$electron=Join-Path $desktopRoot 'node_modules\electron\dist\electron.exe'
$cache=Join-Path $desktopRoot '.cache'
foreach($relative in @('npm','electron','builder','tmp')) { New-Item -ItemType Directory -Path (Join-Path $cache $relative) -Force | Out-Null }
$env:TEMP=Join-Path $cache 'tmp'
$env:TMP=$env:TEMP
$env:npm_config_cache=Join-Path $cache 'npm'
$env:ELECTRON_CACHE=Join-Path $cache 'electron'
$env:ELECTRON_BUILDER_CACHE=Join-Path $cache 'builder'
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
$env:PATH=$nodeDirectory+';'+$env:PATH
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
if (!(Test-Path -LiteralPath $node)) { throw 'Run desktop/setup.cmd first.' }
Set-Location -LiteralPath $desktopRoot
if (!$SkipInstall) {
  & $node $npm install --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Build dependency installation failed.' }
}
if (!(Test-Path -LiteralPath $electron)) { throw 'Run desktop/setup.cmd first.' }
$packagingTools=Join-Path $desktopRoot '.tools\packaging'
function Ensure-PackagingTool([string]$Release,[string]$ArchiveName,[string]$ExpectedHash,[string]$Folder,[string]$Marker) {
  $destination=Join-Path $packagingTools $Folder
  if (Test-Path -LiteralPath (Join-Path $destination $Marker)) { return $destination }
  if (Test-Path -LiteralPath $destination) {
    $existing=@(Get-ChildItem -LiteralPath $destination -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName $Marker) })
    if ($existing.Count -eq 1) { return $existing[0].FullName }
  }
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  $archive=Join-Path $cache $ArchiveName
  Write-Host ('Preparing official packaging tool: '+$Release)
  Invoke-WebRequest -UseBasicParsing -Uri ('https://github.com/electron-userland/electron-builder-binaries/releases/download/'+[Uri]::EscapeDataString($Release)+'/'+$ArchiveName) -OutFile $archive
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedHash) { throw 'Packaging tool checksum mismatch.' }
  & (Join-Path $env:SystemRoot 'System32\tar.exe') -xf $archive -C $destination
  if ($LASTEXITCODE -ne 0) { throw 'Packaging tool extraction failed.' }
  if (!(Test-Path -LiteralPath (Join-Path $destination $Marker))) {
    $matches=@(Get-ChildItem -LiteralPath $destination -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName $Marker) })
    if ($matches.Count -ne 1) { throw 'Packaging tool entrypoint not found.' }
    $destination=$matches[0].FullName
  }
  Remove-Item -LiteralPath $archive -Force
  return $destination
}
$sevenZip=Ensure-PackagingTool '7zip@1.0.0' '7zip-win-x64.tar.gz' 'be071f15bd6da2f78fe81c6ddef2009b0c4d8a51f36b780cb806c7e6df95e1b3' '7zip' 'bin\7za.exe'
$nsis=Ensure-PackagingTool 'nsis@1.2.1' 'nsis-bundle-3.12.tar.gz' '56997fdefe25e7928a1a68b4583d08b240b66cf660234053b20131a74cc082f4' 'nsis' 'makensis.cmd'
$env:ELECTRON_BUILDER_7ZIP_PATH=Join-Path $sevenZip 'bin\7za.exe'
$env:ELECTRON_BUILDER_NSIS_DIR=$nsis
$env:ELECTRON_BUILDER_NSIS_RESOURCES_DIR=$nsis
$testFiles=@(Get-ChildItem -LiteralPath (Join-Path $desktopRoot 'tests') -Filter '*.test.cjs' | ForEach-Object { $_.FullName })
& $node --test @testFiles
if ($LASTEXITCODE -ne 0) { throw 'Desktop checks failed.' }
$iconProcess=Start-Process -FilePath $electron -ArgumentList ('"'+(Join-Path $desktopRoot 'scripts\create-icon.cjs')+'"') -WorkingDirectory $desktopRoot -WindowStyle Hidden -PassThru
try {
  if (!$iconProcess.WaitForExit(60000)) { throw 'Icon preparation timed out.' }
  if ($iconProcess.ExitCode -ne 0) { throw 'Icon preparation failed.' }
} finally { $iconProcess.Dispose() }
& $node (Join-Path $desktopRoot 'node_modules\electron-builder\cli.js') --win nsis --x64 --publish never --config electron-builder.cjs
if ($LASTEXITCODE -ne 0) { throw 'Installer build failed.' }
$installer=Get-ChildItem -LiteralPath (Join-Path $desktopRoot 'dist') -Filter '*-Setup-x64.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (!$installer) { throw 'Installer output is missing.' }
$hash=(Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($installer.FullName+'.sha256'),($hash+'  '+$installer.Name+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
Write-Host ('Installer ready: '+$installer.FullName)
