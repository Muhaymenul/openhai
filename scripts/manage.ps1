param([ValidateSet('start','stop','status','build','backup','restore')][string]$Action='start',[string]$ArchivePath='',[switch]$NoBrowser)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
& (Join-Path $PSScriptRoot 'setup.ps1')
$portableProject=Test-Path -LiteralPath (Join-Path $projectRoot '.portable-project.json')
. (Join-Path $PSScriptRoot 'container-ownership.ps1')
function Invoke-PortableDatabase([string]$Operation) {
  if ($portableProject) { & (Join-Path $PSScriptRoot 'portable-postgres.ps1') -Action $Operation -ProjectRoot $projectRoot }
}
$dockerCommand=Get-Command docker -ErrorAction SilentlyContinue
if ($dockerCommand) { $docker=$dockerCommand.Source } else {
  $docker=Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'
  if (!(Test-Path -LiteralPath $docker)) { throw 'Docker Desktop is required. Install its free personal edition first.' }
}
function Invoke-Compose([string[]]$Arguments) {
  if ($Arguments[0] -eq 'stop') { Stop-ProjectContainers -Docker $docker -ProjectRoot $projectRoot; return }
  & $docker compose @Arguments
  if ($LASTEXITCODE -ne 0) { throw 'The local Docker operation failed. Your data has been preserved.' }
}
function Invoke-Database([string]$Operation,[string]$DatabaseArchive='') {
  $parameters=@{Action=$Operation;ProjectRoot=$projectRoot}
  if ($DatabaseArchive) { $parameters.ArchivePath=$DatabaseArchive }
  & (Join-Path $PSScriptRoot 'postgres.ps1') @parameters
}
function Test-DockerCommand([string[]]$Arguments) {
  # Windows PowerShell 5 treats native stderr as a terminating error under Stop.
  # A failed readiness/image probe is expected and must reach its recovery path.
  $previousPreference=$ErrorActionPreference
  try {
    $ErrorActionPreference='Continue'
    & $docker @Arguments > $null 2> $null
    return ($LASTEXITCODE -eq 0)
  } finally { $ErrorActionPreference=$previousPreference }
}
function Ensure-LocalDocker([bool]$AllowStart=$true) {
  $dockerReady=Test-DockerCommand -Arguments @('info')
  if (!$dockerReady -and !$AllowStart) { return $false }
  if (!$dockerReady) {
    $desktop=Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'
    if (Test-Path -LiteralPath $desktop) { Start-Process -FilePath $desktop -WindowStyle Hidden }
    for ($attempt=0; $attempt -lt 45; $attempt++) {
      Start-Sleep -Seconds 1
      $dockerReady=Test-DockerCommand -Arguments @('info')
      if ($dockerReady) { break }
    }
  }
  if (!$dockerReady) { throw 'Docker is not ready. Open Docker Desktop and check its WSL2 engine, then retry.' }
  $endpoint=(& $docker context inspect --format '{{.Endpoints.docker.Host}}' | Out-String).Trim()
  if (!$endpoint.StartsWith('npipe:') -and !$endpoint.StartsWith('unix:')) { throw 'Only a local Docker engine is allowed; remote/cloud Docker contexts are disabled.' }
  return $true
}
function Assert-ProjectPath([string]$Value) {
  $resolved=[IO.Path]::GetFullPath($Value)
  if (!$resolved.StartsWith($projectRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'The operation must remain inside this project.' }
  return $resolved
}
$dockerReady=Ensure-LocalDocker -AllowStart ($Action -ne 'stop')
if ($Action -eq 'stop' -and !$dockerReady) {
  Invoke-PortableDatabase 'Stop'
  Write-Host 'Already stopped. Docker is offline. All documents, notes and graph records are preserved.'
  exit 0
}
if ($Action -in @('start','build','backup','restore')) { Assert-ProjectContainers -Docker $docker -ProjectRoot $projectRoot }
switch ($Action) {
  'start' {
    foreach ($directory in @('data','runtime','private','backups')) { New-Item -ItemType Directory -Path (Join-Path $projectRoot $directory) -Force | Out-Null }
    if (!(Test-Path -LiteralPath (Join-Path $projectRoot 'private\model.env'))) {
      Copy-Item -LiteralPath (Join-Path $projectRoot 'private.example.env') -Destination (Join-Path $projectRoot 'private\model.env')
    }
    Invoke-PortableDatabase 'Start'
    Invoke-Database 'check'
    $imagesReady=$true
    $images=@(& $docker compose config --images)
    if($LASTEXITCODE -ne 0 -or !$images.Count) { throw 'Unable to read application image names.' }
    foreach($image in $images) { if(!(Test-DockerCommand -Arguments @('image','inspect',$image))) { $imagesReady=$false } }
    $offlineImages=Join-Path $projectRoot 'tools\docker-images\jiaoyan-images.tar'
    if (!$imagesReady -and (Test-Path -LiteralPath $offlineImages)) {
      & $docker image load -i $offlineImages
      if ($LASTEXITCODE -ne 0) { throw 'The offline application images could not be loaded.' }
      $imagesReady=$true
    $images=@(& $docker compose config --images)
    if($LASTEXITCODE -ne 0 -or !$images.Count) { throw 'Unable to read application image names.' }
    foreach($image in $images) { if(!(Test-DockerCommand -Arguments @('image','inspect',$image))) { $imagesReady=$false } }
    }
    if ($imagesReady) { Invoke-Compose -Arguments @('up','-d','--no-build') } else { Invoke-Compose -Arguments @('up','-d','--build') }
    $ready=$false
    for ($attempt=0; $attempt -lt 60; $attempt++) {
      try { $response=Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/research' -UseBasicParsing -TimeoutSec 3; if ($response.StatusCode -eq 200) { $ready=$true; break } } catch { Start-Sleep -Seconds 1 }
    }
    if (!$ready) { Invoke-Compose -Arguments @('logs','--tail','30','web'); throw 'The workspace did not become ready. Check the local logs above.' }
    Write-Host 'Local workspace ready: http://127.0.0.1:3000/workspace'
    if (!$NoBrowser) { Start-Process 'http://127.0.0.1:3000/workspace' }
  }
  'stop' { Invoke-Compose -Arguments @('stop'); Invoke-PortableDatabase 'Stop'; Write-Host 'Stopped. All documents, notes and graph records are preserved.' }
  'status' { Invoke-PortableDatabase 'Check'; Invoke-Database 'status'; Invoke-Compose -Arguments @('ps'); try { (Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/research/health' -TimeoutSec 5) | ConvertTo-Json -Depth 4 } catch { Write-Host 'The web workspace is currently offline.' } }
  'build' { Invoke-PortableDatabase 'Start'; Invoke-Database 'check'; Invoke-Compose -Arguments @('build'); Invoke-Compose -Arguments @('up','-d','--no-build') }
  'backup' {
    Invoke-PortableDatabase 'Start'
    $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
    $stage=Assert-ProjectPath (Join-Path $projectRoot ('tmp\backup-'+$stamp))
    $backup=Assert-ProjectPath (Join-Path $projectRoot ('backups\research-'+$stamp+'.zip'))
    New-Item -ItemType Directory -Path $stage,(Split-Path $backup) -Force | Out-Null
    Invoke-Database 'check'
    $backupCreated=$false
    Invoke-Compose -Arguments @('stop')
    try {
      Invoke-Database 'backup' (Join-Path $stage 'postgresql.dump')
      foreach ($directory in @('data','runtime')) {
        $source=Join-Path $projectRoot $directory
        if (Test-Path -LiteralPath $source) {
          & robocopy $source (Join-Path $stage $directory) /E /XF provider.json *.env /NFL /NDL /NJH /NJS | Out-Null
          if ($LASTEXITCODE -ge 8) { throw 'Unable to copy the stopped workspace for backup.' }
        }
      }
      $manifestFiles=@(Get-ChildItem -LiteralPath $stage -Recurse -File | ForEach-Object {
        [pscustomobject]@{path=$_.FullName.Substring($stage.Length+1);sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}
      })
      [IO.File]::WriteAllText((Join-Path $stage 'backup-manifest.json'),([pscustomobject]@{schema=1;createdAt=[DateTime]::UtcNow.ToString('o');files=$manifestFiles}|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
      Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $backup -CompressionLevel Optimal
      $backupCreated=$true
      Write-Host ('Backup created: '+$backup)
      Write-Host 'Model secrets are excluded. Keep private/model.env separately if needed.'
    } finally {
      Invoke-Compose -Arguments @('up','-d','--no-build')
      if ($backupCreated -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath (Assert-ProjectPath $stage) -Recurse -Force }
    }
  }
  'restore' {
    Invoke-PortableDatabase 'Start'
    if (!$ArchivePath) { $ArchivePath=Read-Host 'Enter the full path to a backup ZIP created by the backup script' }
    $archive=(Resolve-Path -LiteralPath $ArchivePath).Path
    $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
    $stage=Assert-ProjectPath (Join-Path $projectRoot ('tmp\restore-'+$stamp))
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip=[IO.Compression.ZipFile]::OpenRead($archive)
    try {
      foreach ($entry in $zip.Entries) {
        $destination=[IO.Path]::GetFullPath((Join-Path $stage $entry.FullName))
        if (!$destination.StartsWith($stage+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe backup path.' }
      }
    } finally { $zip.Dispose() }
    Expand-Archive -LiteralPath $archive -DestinationPath $stage
    if (!(Test-Path -LiteralPath (Join-Path $stage 'data\research\workspace.json')) -or !(Test-Path -LiteralPath (Join-Path $stage 'runtime\research\state.json')) -or !(Test-Path -LiteralPath (Join-Path $stage 'backup-manifest.json'))) { throw 'This is not a full workspace backup. Web-exported results ZIPs are not full service backups.' }
    $manifest=Get-Content -LiteralPath (Join-Path $stage 'backup-manifest.json') -Encoding UTF8 -Raw | ConvertFrom-Json
    if ($manifest.schema -ne 1 -or !$manifest.files) { throw 'Invalid backup manifest.' }
    $databaseArchive=Join-Path $stage 'postgresql.dump'
    $hasDatabaseArchive=Test-Path -LiteralPath $databaseArchive -PathType Leaf
    $manifestPaths=@($manifest.files | ForEach-Object { $_.path.Replace('/','\') })
    if ($hasDatabaseArchive -and $manifestPaths -notcontains 'postgresql.dump') { throw 'The backup manifest does not cover the PostgreSQL dump.' }
    if ($manifestPaths -notcontains 'data\research\workspace.json' -or $manifestPaths -notcontains 'runtime\research\state.json') { throw 'The backup manifest does not cover the complete workspace state.' }
    $workspace=Get-Content -LiteralPath (Join-Path $stage 'data\research\workspace.json') -Encoding UTF8 -Raw | ConvertFrom-Json
    $runtime=Get-Content -LiteralPath (Join-Path $stage 'runtime\research\state.json') -Encoding UTF8 -Raw | ConvertFrom-Json
    if ($workspace.schemaVersion -ne 1 -or $runtime.schema_version -ne 1 -or !($workspace.PSObject.Properties.Name -contains 'papers') -or !($runtime.PSObject.Properties.Name -contains 'runs') -or !($runtime.PSObject.Properties.Name -contains 'sessions')) { throw 'Unsupported or incomplete backup state.' }
    foreach ($file in $manifest.files) {
      $checked=[IO.Path]::GetFullPath((Join-Path $stage $file.path))
      if (!$checked.StartsWith($stage+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $checked -PathType Leaf)) { throw 'A backup file is missing or has an unsafe path.' }
      if ((Get-FileHash -LiteralPath $checked -Algorithm SHA256).Hash -ne $file.sha256) { throw 'Backup checksum mismatch. The running workspace has not been modified.' }
    }
    $previous=Assert-ProjectPath (Join-Path $projectRoot ('backups\before-restore-'+$stamp))
    New-Item -ItemType Directory -Path $previous -Force | Out-Null
    Invoke-Database 'check'
    Invoke-Compose -Arguments @('stop')
    $moved=[Collections.Generic.List[string]]::new()
    $installed=[Collections.Generic.List[string]]::new()
    $canRestart=$true
    $databaseChanged=$false
    $restoreCompleted=$false
    try {
      Invoke-Database 'backup' (Join-Path $previous 'postgresql.dump')
      foreach ($directory in @('data','runtime')) {
        $live=Assert-ProjectPath (Join-Path $projectRoot $directory)
        $incoming=Assert-ProjectPath (Join-Path $stage $directory)
        $old=Assert-ProjectPath (Join-Path $previous $directory)
        if (Test-Path -LiteralPath $live) { Move-Item -LiteralPath $live -Destination $old; $moved.Add($directory) }
        Move-Item -LiteralPath $incoming -Destination $live
        $installed.Add($directory)
      }
      if ($hasDatabaseArchive) {
        Invoke-Database 'restore' $databaseArchive
      } else {
        Invoke-Database 'ResetLegacy'
      }
      $databaseChanged=$true
      Write-Host ('Restored. The previous directories are preserved at '+$previous)
      $restoreCompleted=$true
    } catch {
      $failure=$_
      try {
        if ($databaseChanged) { Invoke-Database 'restore' (Join-Path $previous 'postgresql.dump') }
        foreach ($directory in @('runtime','data')) {
          $live=Assert-ProjectPath (Join-Path $projectRoot $directory)
          $old=Assert-ProjectPath (Join-Path $previous $directory)
          if ($installed.Contains($directory) -and (Test-Path -LiteralPath $live)) { Move-Item -LiteralPath $live -Destination (Assert-ProjectPath (Join-Path $stage ('failed-'+$directory))) }
          if ($moved.Contains($directory) -and (Test-Path -LiteralPath $old)) { Move-Item -LiteralPath $old -Destination $live }
        }
      } catch {
        $canRestart=$false
        Write-Host ('Rollback requires attention. Services remain stopped. Original directories: '+$previous)
      }
      throw $failure
    } finally {
      if ($canRestart) { Invoke-Compose -Arguments @('up','-d','--no-build') }
      if ($restoreCompleted -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath (Assert-ProjectPath $stage) -Recurse -Force }
    }
  }
}
