param([ValidateSet('start','stop','status','build','backup','restore')][string]$Action='start',[string]$ArchivePath='',[switch]$NoBrowser)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
if ($Action -in @('start','build')) {
  & (Join-Path $PSScriptRoot 'setup.ps1')
}
$dockerCommand=Get-Command docker -ErrorAction SilentlyContinue
if ($dockerCommand) { $docker=$dockerCommand.Source } else {
  $dockerCandidates=@(
    (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'),
    (Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe')
  )
  $docker=@($dockerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1)[0]
  if (!$docker) { throw 'Docker with Compose v2 is required. Install Docker Desktop, then retry.' }
}
function Invoke-Compose([string[]]$Arguments) {
  & $docker compose @Arguments
  if ($LASTEXITCODE -ne 0) { throw 'The local Docker operation failed. Your data has been preserved.' }
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
    $desktopCandidates=@(
      (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'),
      (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe')
    )
    $desktop=@($desktopCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1)[0]
    if ($desktop) { Start-Process -FilePath $desktop -WindowStyle Hidden }
    for ($attempt=0; $attempt -lt 45; $attempt++) {
      Start-Sleep -Seconds 1
      $dockerReady=Test-DockerCommand -Arguments @('info')
      if ($dockerReady) { break }
    }
  }
  if (!$dockerReady) { throw 'Docker is not ready. Open Docker Desktop and check its WSL2 engine, then retry.' }
  if ($env:DOCKER_CONTEXT) {
    $endpoint=(& $docker context inspect $env:DOCKER_CONTEXT --format '{{.Endpoints.docker.Host}}' | Out-String).Trim()
  } elseif ($env:DOCKER_HOST) {
    $endpoint=$env:DOCKER_HOST
  } else {
    $endpoint=(& $docker context inspect --format '{{.Endpoints.docker.Host}}' | Out-String).Trim()
  }
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
  Write-Host 'Already stopped. Docker is offline. All documents, notes and graph records are preserved.'
  exit 0
}
$configurationText=(& $docker compose config --format json | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'Unable to read the Compose settings. Check .env and docker-compose.yml.' }
$composeConfiguration=$configurationText | ConvertFrom-Json
$webPort=[int]$composeConfiguration.services.web.ports[0].published
if ($webPort -lt 1 -or $webPort -gt 65535) { throw 'RESEARCH_WEB_PORT must be a port number between 1 and 65535.' }
$baseUrl='http://127.0.0.1:'+$webPort
$workspaceUrl=$baseUrl+'/workspace'
$serviceImages=@($composeConfiguration.services.web.image,$composeConfiguration.services.paperflow.image)
switch ($Action) {
  'start' {
    $imagesReady=Test-DockerCommand -Arguments (@('image','inspect')+$serviceImages)
    if (!$imagesReady) { Invoke-Compose -Arguments @('build','--builder','default') }
    Invoke-Compose -Arguments @('up','-d','--no-build')
    $ready=$false
    for ($attempt=0; $attempt -lt 60; $attempt++) {
      try { $response=Invoke-WebRequest -Uri ($baseUrl+'/api/research') -UseBasicParsing -TimeoutSec 3; if ($response.StatusCode -eq 200) { $ready=$true; break } } catch { Start-Sleep -Seconds 1 }
    }
    if (!$ready) { Invoke-Compose -Arguments @('logs','--tail','30','web'); throw 'The workspace did not become ready. Check the local logs above.' }
    Write-Host ('Local workspace ready: '+$workspaceUrl)
    if (!$NoBrowser) { Start-Process $workspaceUrl }
  }
  'stop' { Invoke-Compose -Arguments @('stop'); Write-Host 'Stopped. All documents, notes and graph records are preserved.' }
  'status' { Invoke-Compose -Arguments @('ps'); try { (Invoke-RestMethod -Uri ($baseUrl+'/api/research/health') -TimeoutSec 5) | ConvertTo-Json -Depth 4 } catch { Write-Host 'The web workspace is currently offline.' } }
  'build' { Invoke-Compose -Arguments @('build','--builder','default'); Invoke-Compose -Arguments @('up','-d','--no-build') }
  'backup' {
    $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
    $stage=Assert-ProjectPath (Join-Path $projectRoot ('tmp\backup-'+$stamp))
    $backup=Assert-ProjectPath (Join-Path $projectRoot ('backups\research-'+$stamp+'.zip'))
    New-Item -ItemType Directory -Path $stage,(Split-Path $backup) -Force | Out-Null
    Invoke-Compose -Arguments @('stop')
    try {
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
      Write-Host ('Backup created: '+$backup)
      Write-Host 'Model secrets are excluded. Keep private/model.env separately if needed.'
    } finally {
      try {
        if (Test-Path -LiteralPath $stage) {
          Remove-Item -LiteralPath (Assert-ProjectPath $stage) -Recurse -Force
        }
      } finally { Invoke-Compose -Arguments @('up','-d','--no-build') }
    }
  }
  'restore' {
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
    $manifestPaths=@($manifest.files | ForEach-Object { $_.path.Replace('/','\') })
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
    Invoke-Compose -Arguments @('stop')
    $moved=[Collections.Generic.List[string]]::new()
    $installed=[Collections.Generic.List[string]]::new()
    $canRestart=$true
    try {
      foreach ($directory in @('data','runtime')) {
        $live=Assert-ProjectPath (Join-Path $projectRoot $directory)
        $incoming=Assert-ProjectPath (Join-Path $stage $directory)
        $old=Assert-ProjectPath (Join-Path $previous $directory)
        if (Test-Path -LiteralPath $live) { Move-Item -LiteralPath $live -Destination $old; $moved.Add($directory) }
        Move-Item -LiteralPath $incoming -Destination $live
        $installed.Add($directory)
      }
      Write-Host ('Restored. The previous directories are preserved at '+$previous)
    } catch {
      $failure=$_
      try {
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
    } finally { if ($canRestart) { Invoke-Compose -Arguments @('up','-d','--no-build') } }
    if (Test-Path -LiteralPath $stage) {
      Remove-Item -LiteralPath (Assert-ProjectPath $stage) -Recurse -Force
    }
  }
}
