$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$folder=Join-Path $projectRoot 'tools\docker-images'
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$temporary=Join-Path $folder 'jiaoyan-images.new.tar'
$archive=Join-Path $folder 'jiaoyan-images.tar'
foreach($filePath in @($temporary,$archive)) {
  if(!([IO.Path]::GetFullPath($filePath)).StartsWith(([IO.Path]::GetFullPath($folder)+'\'),[StringComparison]::OrdinalIgnoreCase)) { throw 'Image archive path must remain inside this project.' }
}
Push-Location -LiteralPath $projectRoot
try { $images=@(& docker compose config --images) } finally { Pop-Location }
if ($LASTEXITCODE -ne 0 -or !$images.Count) { throw 'Unable to read this project image names.' }
& docker image save -o $temporary @images
if($LASTEXITCODE -ne 0) { throw 'Application image export failed. The previous archive was retained.' }
$hash=(Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant()
Move-Item -LiteralPath $temporary -Destination $archive -Force
[IO.File]::WriteAllText(($archive+'.sha256'),($hash+'  jiaoyan-images.tar'+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
Write-Host '已更新本项目的离线后台镜像。'
