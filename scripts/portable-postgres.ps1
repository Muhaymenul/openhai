param(
  [ValidateSet('Start','Stop','Check','Map')][string]$Action='Check',
  [string]$ProjectRoot=''
)

$ErrorActionPreference='Stop'
if (!$ProjectRoot) { $ProjectRoot=Join-Path $PSScriptRoot '..' }
$ProjectRoot=[IO.Path]::GetFullPath($ProjectRoot)
$physicalBinDirectory=Join-Path $ProjectRoot 'tools\postgresql\bin'
$physicalDataDirectory=Join-Path $ProjectRoot 'database\data'
$binDirectory=$physicalBinDirectory
$dataDirectory=$physicalDataDirectory
$logDirectory=Join-Path $ProjectRoot 'database\logs'
$logPath=Join-Path $logDirectory 'server.log'
$mappingPath=Join-Path $ProjectRoot 'database\portable-path.json'
$configurationPath=Join-Path $ProjectRoot 'private\postgres.env'
$adminConfigurationPath=Join-Path $ProjectRoot 'private\portable-postgres-admin.env'

function Read-LocalConfiguration([string]$Path) {
  if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { throw ('Local PostgreSQL configuration is missing: '+[IO.Path]::GetFileName($Path)+'.') }
  $values=@{}
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ($line -match '^([A-Z_]+)=(.*)$') { $values[$Matches[1]]=$Matches[2].Trim() }
  }
  return $values
}

function Normalize-LocalPath([string]$Value) {
  return [IO.Path]::GetFullPath($Value).TrimEnd([char[]]'\/')
}

function Initialize-DriveApi {
  if ('JiaoyanPortablePostgres.NativeDrive' -as [type]) { return }
  # QueryDosDeviceW reads the exact Unicode mapping target. Parsing `subst`
  # console output is unreliable when the surrounding shell uses another codepage.
  # Windows PowerShell 5 compiles Add-Type in TEMP; keep those files in the project.
  $temporary=Join-Path $ProjectRoot 'database\tmp'
  New-Item -ItemType Directory -Path $temporary -Force | Out-Null
  $previousTemp=$env:TEMP
  $previousTmp=$env:TMP
  try {
    $env:TEMP=$temporary
    $env:TMP=$temporary
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
namespace JiaoyanPortablePostgres {
  public static class NativeDrive {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern uint QueryDosDevice(string name, StringBuilder target, uint size);
  }
}
'@ -ErrorAction Stop | Out-Null
  } finally { $env:TEMP=$previousTemp; $env:TMP=$previousTmp }
}

function Get-DriveTarget([string]$Drive) {
  Initialize-DriveApi
  $buffer=New-Object Text.StringBuilder 32768
  $length=[JiaoyanPortablePostgres.NativeDrive]::QueryDosDevice($Drive,$buffer,32768)
  if ($length -eq 0) {
    $nativeError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($nativeError -in @(2,3)) { return $null }
    throw ('Unable to inspect Windows drive aliases (error '+$nativeError+'). Use a normal, non-restricted Windows session. No existing drive was changed.')
  }
  return $buffer.ToString().Split([char]0)[0]
}

function Test-ProjectMapping([string]$Drive) {
  $target=Get-DriveTarget $Drive
  if (!$target -or !$target.StartsWith('\??\',[StringComparison]::Ordinal)) { return $false }
  try {
    return (Normalize-LocalPath $target.Substring(4)).Equals((Normalize-LocalPath $ProjectRoot),[StringComparison]::OrdinalIgnoreCase)
  } catch { return $false }
}

function Save-MappingState([string]$Drive,[bool]$Owned) {
  $state=[pscustomobject]@{schema=1;drive=$Drive;projectRoot=$ProjectRoot;createdByProject=$Owned}
  New-Item -ItemType Directory -Path (Split-Path $mappingPath) -Force | Out-Null
  [IO.File]::WriteAllText($mappingPath,($state | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
  return $state
}

function Invoke-Subst([string[]]$Arguments) {
  $previousPreference=$ErrorActionPreference
  try {
    $ErrorActionPreference='Continue'
    & (Join-Path $env:SystemRoot 'System32\subst.exe') @Arguments > $null 2> $null
    if ($LASTEXITCODE -ne 0) { throw 'Unable to create or remove the project drive alias. Existing drives were preserved.' }
  } finally { $ErrorActionPreference=$previousPreference }
}

function Ensure-DriveMapping([bool]$AllowCreate) {
  $saved=$null
  if (Test-Path -LiteralPath $mappingPath -PathType Leaf) {
    try {
      $candidate=[IO.File]::ReadAllText($mappingPath) | ConvertFrom-Json
      if ($candidate.schema -eq 1 -and $candidate.drive -match '^[R-Z]:$') { $saved=$candidate }
    } catch { }
  }
  if ($saved -and (Test-ProjectMapping $saved.drive)) {
    $owned=($saved.createdByProject -eq $true -and (Normalize-LocalPath $saved.projectRoot).Equals((Normalize-LocalPath $ProjectRoot),[StringComparison]::OrdinalIgnoreCase))
    return Save-MappingState $saved.drive $owned
  }
  foreach ($letter in [char[]]'RSTUVWXYZ') {
    $drive=[string]$letter+':'
    if (Test-ProjectMapping $drive) { return Save-MappingState $drive $false }
  }
  if (!$AllowCreate) { return $null }
  $choices=@()
  if ($saved) { $choices+=@($saved.drive) }
  $choices+=@([char[]]'RSTUVWXYZ' | ForEach-Object { [string]$_+':' })
  foreach ($drive in ($choices | Select-Object -Unique)) {
    if ((Get-DriveTarget $drive) -or [IO.Directory]::Exists($drive+'\')) { continue }
    Invoke-Subst @($drive,$ProjectRoot)
    if (!(Test-ProjectMapping $drive)) { throw 'The new PostgreSQL drive alias could not be verified. No database was started.' }
    return Save-MappingState $drive $true
  }
  throw 'No free drive letter from R through Z is available for the portable PostgreSQL path.'
}

function Remove-OwnedMapping($Mapping) {
  if (!$Mapping -or $Mapping.createdByProject -ne $true) { return }
  if (!(Test-ProjectMapping $Mapping.drive)) { throw 'The drive alias changed ownership. It was left unchanged.' }
  Invoke-Subst @($Mapping.drive,'/D')
  Save-MappingState $Mapping.drive $false | Out-Null
}

function Test-OwnDataPath([string]$Value) {
  $normal=Normalize-LocalPath $Value
  return $normal.Equals((Normalize-LocalPath $dataDirectory),[StringComparison]::OrdinalIgnoreCase) -or
    $normal.Equals((Normalize-LocalPath $physicalDataDirectory),[StringComparison]::OrdinalIgnoreCase)
}

function Invoke-LocalTool([string]$Name,[string[]]$Arguments) {
  # Windows PowerShell 5 treats a native stderr line as an ErrorRecord. Capture
  # it without letting that conversion interrupt an expected status probe.
  $previousPreference=$ErrorActionPreference
  try {
    $ErrorActionPreference='Continue'
    $output=@(& (Join-Path $binDirectory $Name) @Arguments 2>&1)
    $nativeExitCode=$LASTEXITCODE
    return [pscustomobject]@{ Code=$nativeExitCode; Lines=@($output | ForEach-Object { $_.ToString() }) }
  } finally { $ErrorActionPreference=$previousPreference }
}

function Quote-ProcessArgument([string]$Value) {
  if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
  # Windows command-line quoting: double backslashes immediately before quotes
  # and at the end of a quoted argument, preserving literal path separators.
  return '"'+(($Value -replace '(\\*)"','$1$1\"') -replace '(\\+)$','$1$1')+'"'
}

function Invoke-ClusterOperation([string[]]$Arguments) {
  # pg_ctl exits after starting postgres, whose inherited output handles can
  # otherwise keep a PowerShell native-output pipeline waiting indefinitely.
  # Wait for this one manager process, not the complete descendant process tree.
  $quoted=@($Arguments | ForEach-Object { Quote-ProcessArgument $_ })
  $operation=Start-Process -FilePath (Join-Path $binDirectory 'pg_ctl.exe') -ArgumentList $quoted -WorkingDirectory $aliasRoot -WindowStyle Hidden -PassThru
  try {
    $null=$operation.Handle
    if (!$operation.WaitForExit(55000)) { throw 'The PostgreSQL control operation did not finish. Review database/logs/server.log before retrying.' }
    return $operation.ExitCode
  } finally { $operation.Dispose() }
}

function Invoke-LocalSql([string]$User,[string]$Password,[string]$Database,[string]$Sql) {
  $previousPassword=$env:PGPASSWORD
  $previousTimeout=$env:PGCONNECT_TIMEOUT
  try {
    $env:PGPASSWORD=$Password
    $env:PGCONNECT_TIMEOUT='3'
    $result=Invoke-LocalTool 'psql.exe' @('-h','127.0.0.1','-p',$port,'-U',$User,'-d',$Database,'-w','-X','-qAt','-v','ON_ERROR_STOP=1','-c',$Sql)
    if ($result.Code -ne 0) {
      # Do not echo commands, configuration, model keys, or connection strings.
      throw 'Portable PostgreSQL authentication or identity check failed. Check the local configuration and server log.'
    }
    return (($result.Lines -join [Environment]::NewLine).Trim())
  } finally {
    $env:PGPASSWORD=$previousPassword
    $env:PGCONNECT_TIMEOUT=$previousTimeout
  }
}

function Test-LocalPort {
  $client=New-Object Net.Sockets.TcpClient
  try {
    $pending=$client.BeginConnect('127.0.0.1',[int]$port,$null,$null)
    try {
      if (!$pending.AsyncWaitHandle.WaitOne(1000)) { return $false }
      $client.EndConnect($pending)
      return $true
    } finally { $pending.AsyncWaitHandle.Close() }
  } catch { return $false }
  finally { $client.Close() }
}

function Get-OwnClusterStatus {
  $result=Invoke-LocalTool 'pg_ctl.exe' @('-D',$dataDirectory,'status')
  if ($result.Code -eq 0) { return $true }
  if ($result.Code -eq 3) { return $false }
  throw 'Unable to determine the status of this project PostgreSQL cluster. No process was stopped.'
}

function Assert-PidFileIdentity {
  $pidPath=Join-Path $dataDirectory 'postmaster.pid'
  if (!(Test-Path -LiteralPath $pidPath -PathType Leaf)) { throw 'Portable PostgreSQL PID file is missing. No process was stopped.' }
  $lines=[IO.File]::ReadAllLines($pidPath)
  if ($lines.Length -lt 4 -or $lines[0] -notmatch '^\d+$' -or $lines[3].Trim() -ne $port) {
    throw 'Portable PostgreSQL PID file does not match the configured port. No process was stopped.'
  }
  if (!(Test-OwnDataPath $lines[1].Trim())) {
    throw 'Portable PostgreSQL PID file belongs to another data directory. No process was stopped.'
  }
}

function Assert-RunningClusterIdentity {
  if (!(Get-OwnClusterStatus)) { throw 'This project PostgreSQL cluster is not running.' }
  Assert-PidFileIdentity
  $probe=Invoke-LocalTool 'pg_isready.exe' @('-h','127.0.0.1','-p',$port,'-t','3')
  if ($probe.Code -ne 0) { throw 'Portable PostgreSQL is not ready. No other database process was stopped.' }
  $directory=Invoke-LocalSql $adminUser $adminPassword 'postgres' "SELECT current_setting('data_directory');"
  if (!(Test-OwnDataPath $directory)) {
    throw 'The configured port belongs to a different PostgreSQL data directory. No process was stopped.'
  }
  $actualPort=Invoke-LocalSql $adminUser $adminPassword 'postgres' "SELECT current_setting('port');"
  if ($actualPort -ne $port) { throw 'The server is using another PostgreSQL port. No process was stopped.' }
  $answer=Invoke-LocalSql $configuration.RESEARCH_DATABASE_USER $configuration.RESEARCH_DATABASE_PASSWORD $configuration.RESEARCH_DATABASE_NAME 'SELECT 1;'
  if ($answer -ne '1') { throw 'The dedicated application database did not pass its connection check.' }
}

$mutex=[Threading.Mutex]::new($false,'Local\JiaoyanPortablePostgres-55432')
$acquired=$false
try {
  try { $acquired=$mutex.WaitOne(30000) }
  catch [Threading.AbandonedMutexException] { $acquired=$true }
  if (!$acquired) { throw 'Another portable PostgreSQL operation is still running. Retry shortly.' }
  $mapping=Ensure-DriveMapping ($Action -in @('Start','Map'))
  if ($Action -eq 'Map') { Write-Output ($mapping.drive+'\'); return }
  if (!$mapping) {
    if ($Action -eq 'Stop' -and !(Test-Path -LiteralPath (Join-Path $physicalDataDirectory 'postmaster.pid'))) {
      Write-Host 'This project PostgreSQL cluster is already stopped. Other databases were left unchanged.'
      return
    }
    throw 'The project PostgreSQL drive alias is missing. Run Start or Map from this user session.'
  }
  $aliasRoot=$mapping.drive+'\'
  $binDirectory=Join-Path $aliasRoot 'tools\postgresql\bin'
  $dataDirectory=Join-Path $aliasRoot 'database\data'
  $logDirectory=Join-Path $aliasRoot 'database\logs'
  $logPath=Join-Path $logDirectory 'server.log'
  foreach ($name in @('pg_ctl.exe','pg_isready.exe','psql.exe')) {
    if (!(Test-Path -LiteralPath (Join-Path $binDirectory $name) -PathType Leaf)) { throw ('Portable PostgreSQL tool is missing: '+$name+'.') }
  }
  if (!(Test-Path -LiteralPath (Join-Path $dataDirectory 'PG_VERSION') -PathType Leaf)) {
    if ($Action -eq 'Stop' -and !(Test-Path -LiteralPath (Join-Path $physicalDataDirectory 'postmaster.pid'))) {
      Remove-OwnedMapping $mapping
      Write-Host 'No initialized PostgreSQL cluster is running. The project-created alias was released.'
      return
    }
    throw 'The project PostgreSQL cluster has not been initialized. Its migration must finish before startup.'
  }
  $configuration=Read-LocalConfiguration $configurationPath
  $admin=Read-LocalConfiguration $adminConfigurationPath
  foreach ($key in @('RESEARCH_DATABASE_PORT','RESEARCH_DATABASE_NAME','RESEARCH_DATABASE_USER','RESEARCH_DATABASE_PASSWORD')) {
    if (!$configuration[$key]) { throw ('PostgreSQL configuration is incomplete: '+$key+'.') }
  }
  $port=$configuration.RESEARCH_DATABASE_PORT
  if ($port -ne '55432') { throw 'Portable PostgreSQL is limited to the dedicated port 55432.' }
  if ($configuration.RESEARCH_DATABASE_NAME -ne 'jiaoyan' -or $configuration.RESEARCH_DATABASE_USER -ne 'jiaoyan') {
    throw 'Portable database management is limited to the dedicated jiaoyan database and role.'
  }
  $adminUser=$admin.POSTGRES_ADMIN_USER
  if (!$adminUser) { $adminUser='jiaoyan_admin' }
  if ($adminUser -ne 'jiaoyan_admin' -or !$admin.POSTGRES_ADMIN_PASSWORD) { throw 'Portable PostgreSQL administrator configuration is incomplete.' }
  $adminPassword=$admin.POSTGRES_ADMIN_PASSWORD
  switch ($Action) {
    'Start' {
      if (Get-OwnClusterStatus) {
        Assert-RunningClusterIdentity
        Write-Host 'Portable PostgreSQL is already ready on local port 55432.'
        break
      }
      if (Test-LocalPort) { throw 'Port 55432 is occupied by another process. It was left unchanged.' }
      $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
      $principal=[Security.Principal.WindowsPrincipal]::new($identity)
      if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Start the portable database from a normal, non-administrator desktop session.'
      }
      $volume=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($physicalDataDirectory))
      if ($volume.DriveFormat -ne 'NTFS') { throw 'The portable PostgreSQL data directory requires an NTFS drive.' }
      New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
      # Keep listen_addresses and pg_hba.conf in the migrated cluster settings;
      # the migration configures the limited Docker-host access it requires.
      $code=Invoke-ClusterOperation @('-D',$dataDirectory,'-l',$logPath,'-o',('-p'+$port),'-w','-t','45','start')
      if ($code -ne 0) { throw 'Portable PostgreSQL did not finish starting. Review database/logs/server.log.' }
      Assert-RunningClusterIdentity
      Write-Host 'Portable PostgreSQL ready: this project database/data on local port 55432.'
    }
    'Check' {
      Assert-RunningClusterIdentity
      Write-Host 'Portable PostgreSQL verified: application connection and project data directory match.'
    }
    'Stop' {
      if (!(Get-OwnClusterStatus)) {
        Remove-OwnedMapping $mapping
        Write-Host 'This project PostgreSQL cluster is already stopped. Other databases were left unchanged.'
        break
      }
      Assert-RunningClusterIdentity
      $code=Invoke-ClusterOperation @('-D',$dataDirectory,'-m','fast','-w','-t','45','stop')
      if ($code -ne 0) { throw 'This project PostgreSQL cluster did not finish stopping. Keep the drive connected.' }
      if (Get-OwnClusterStatus) { throw 'This project PostgreSQL cluster still reports running. Keep the drive connected.' }
      Remove-OwnedMapping $mapping
      Write-Host 'This project PostgreSQL cluster stopped. Data and other database services were preserved.'
    }
  }
} finally {
  if ($acquired) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
  $adminPassword=$null
  $admin=$null
  $configuration=$null
}
