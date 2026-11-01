param()
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

foreach ($directory in @('data', 'runtime', 'private', 'backups')) {
  New-Item -ItemType Directory -Path (Join-Path $projectRoot $directory) -Force | Out-Null
}

$templates = @(
  @{ source = '.env.example'; destination = '.env' },
  @{ source = 'private.example.env'; destination = 'private\model.env' }
)
foreach ($template in $templates) {
  $destination = Join-Path $projectRoot $template.destination
  if (!(Test-Path -LiteralPath $destination)) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $template.source) -Destination $destination
    Write-Host ('Created ' + $template.destination)
  }
}
Write-Host 'Setup ready. Existing settings were preserved.'
Write-Host 'For AI features, edit private/model.env with your own endpoint, model ID and API key.'
