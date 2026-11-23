# Docker emits UTF-8 even when Windows PowerShell has no interactive console.
function Get-ProjectContainerInventory([string]$Docker,[string]$ProjectRoot) {
  $previousEncoding=[Console]::OutputEncoding
  try {
    [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
    $expected=[IO.Path]::GetFullPath($ProjectRoot).TrimEnd([char[]]'\/')
    $owned=@(); $foreign=@()
    $ids=@(& $Docker compose ps --all --quiet)
    if($LASTEXITCODE -ne 0) { throw 'Unable to inspect project containers. No services were stopped.' }
    foreach($id in $ids) {
      if(!$id.Trim()) { continue }
      $labelText=(& $Docker inspect --format '{{json .Config.Labels}}' $id | Out-String)
      if($LASTEXITCODE -ne 0) { throw 'Container ownership could not be confirmed. No services were stopped.' }
      $labels=$labelText | ConvertFrom-Json
      $label=$labels.'com.docker.compose.project.working_dir'
      $belongs=$false
      if($label) { $belongs=([IO.Path]::GetFullPath($label).TrimEnd([char[]]'\/')).Equals($expected,[StringComparison]::OrdinalIgnoreCase) }
      $mountText=(& $Docker inspect --format '{{json .Mounts}}' $id | Out-String)
      if($LASTEXITCODE -ne 0) { throw 'Container mounts could not be checked. No services were stopped.' }
      $mounts=$mountText | ConvertFrom-Json
      foreach($mount in $mounts) {
        if($mount.Type -ne 'bind') { continue }
        $source=$mount.Source
        if($source -match '^/run/desktop/mnt/host/([a-z])/(.*)$') { $source=$Matches[1]+':\'+$Matches[2].Replace('/','\') }
        $actual=[IO.Path]::GetFullPath($source).TrimEnd([char[]]'\/')
        if(!$actual.Equals($expected,[StringComparison]::OrdinalIgnoreCase) -and !$actual.StartsWith($expected+'\',[StringComparison]::OrdinalIgnoreCase)) { $belongs=$false }
      }
      if($belongs) { $owned+=$id } else { $foreign+=$id }
    }
    return [pscustomobject]@{Owned=$owned;Foreign=$foreign}
  } finally { [Console]::OutputEncoding=$previousEncoding }
}
function Assert-ProjectContainers([string]$Docker,[string]$ProjectRoot) {
  $inventory=Get-ProjectContainerInventory -Docker $Docker -ProjectRoot $ProjectRoot
  if($inventory.Foreign.Count -gt 0) { throw 'The existing backend belongs to another project folder. Close it before starting this project. It was left unchanged.' }
}
function Stop-ProjectContainers([string]$Docker,[string]$ProjectRoot) {
  $inventory=Get-ProjectContainerInventory -Docker $Docker -ProjectRoot $ProjectRoot
  if($inventory.Owned.Count -gt 0) {
    & $Docker stop @($inventory.Owned)
    if($LASTEXITCODE -ne 0) { throw 'The project containers could not be stopped.' }
  }
  if($inventory.Foreign.Count -gt 0) { Write-Host 'Containers from another project folder were left running.' }
}