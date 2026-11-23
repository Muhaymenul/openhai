param(
  [ValidateSet('check','status','backup','restore','ResetLegacy')][string]$Action='check',
  [string]$ArchivePath='',
  [string]$ProjectRoot='',
  [string]$Schema='public'
)

$ErrorActionPreference='Stop'
if (!$ProjectRoot) { $ProjectRoot=Join-Path $PSScriptRoot '..' }
$ProjectRoot=[IO.Path]::GetFullPath($ProjectRoot)
$configPath=Join-Path $ProjectRoot 'private\postgres.env'
if (!(Test-Path -LiteralPath $configPath -PathType Leaf)) { throw 'PostgreSQL configuration is missing: private/postgres.env.' }
$database=@{}
foreach ($line in [IO.File]::ReadAllLines($configPath)) {
  if ($line -match '^([A-Z_]+)=(.*)$') { $database[$Matches[1]]=$Matches[2].Trim() }
}
foreach ($key in @('RESEARCH_DATABASE_PORT','RESEARCH_DATABASE_NAME','RESEARCH_DATABASE_USER','RESEARCH_DATABASE_PASSWORD')) {
  if (!$database[$key]) { throw ('PostgreSQL configuration is incomplete: '+$key+'.') }
}
if ($database.RESEARCH_DATABASE_NAME -ne 'jiaoyan' -or $database.RESEARCH_DATABASE_USER -ne 'jiaoyan') { throw 'Database management is limited to the dedicated jiaoyan database and role.' }
if ($database.RESEARCH_DATABASE_PORT -notmatch '^\d{1,5}$' -or [int]$database.RESEARCH_DATABASE_PORT -notin 1..65535) { throw 'Invalid PostgreSQL port.' }
if ($Schema -notmatch '^[a-z_][a-z0-9_]*$') { throw 'Invalid PostgreSQL schema.' }

$portableBin=Join-Path $ProjectRoot 'tools\postgresql\bin'
if (Test-Path -LiteralPath (Join-Path $ProjectRoot '.portable-project.json')) {
  if (!(Test-Path -LiteralPath (Join-Path $portableBin 'pg_ctl.exe'))) { throw 'This portable project is missing tools/postgresql/bin. The E-drive installation was not used.' }
  $binDirectory=$portableBin
} else { $binDirectory=$env:RESEARCH_POSTGRES_BIN }
if (!$binDirectory) {
  $psqlCommand=Get-Command psql.exe -ErrorAction SilentlyContinue
  if ($psqlCommand) { $binDirectory=Split-Path $psqlCommand.Source }
}
if (!$binDirectory) {
  $service=Get-CimInstance Win32_Service -Filter "Name='postgresql-x64-18'" -ErrorAction SilentlyContinue
  if ($service -and $service.PathName -match '^"([^"]+\\pg_ctl\.exe)"') { $binDirectory=Split-Path $Matches[1] }
}
if (!$binDirectory) { throw 'PostgreSQL client tools were not found. Add the installed bin directory to PATH or set RESEARCH_POSTGRES_BIN.' }
$binDirectory=[IO.Path]::GetFullPath($binDirectory)
foreach ($name in @('psql.exe','pg_dump.exe','pg_restore.exe')) {
  if (!(Test-Path -LiteralPath (Join-Path $binDirectory $name) -PathType Leaf)) { throw ('PostgreSQL tool is missing: '+$name+'. Set RESEARCH_POSTGRES_BIN to the installed bin directory.') }
}
$connection=@('-h','127.0.0.1','-p',$database.RESEARCH_DATABASE_PORT,'-U',$database.RESEARCH_DATABASE_USER,'-d',$database.RESEARCH_DATABASE_NAME,'-w')

function Invoke-PostgresTool([string]$Tool,[string[]]$Arguments) {
  $previousPassword=$env:PGPASSWORD
  $previousTimeout=$env:PGCONNECT_TIMEOUT
  $previousPreference=$ErrorActionPreference
  try {
    $env:PGPASSWORD=$database.RESEARCH_DATABASE_PASSWORD
    $env:PGCONNECT_TIMEOUT='5'
    # Capture native stderr under PowerShell 5 without turning normal tool
    # diagnostics into an exception before the exit code can be inspected.
    $ErrorActionPreference='Continue'
    $output=@(& (Join-Path $binDirectory $Tool) @Arguments 2>&1)
    $code=$LASTEXITCODE
    if ($code -ne 0) {
      $message=($output | Out-String).Trim()
      if ($message) { Write-Host $message }
      throw ('PostgreSQL '+$Tool+' failed. Check the database service and local configuration.')
    }
    return $output
  } finally {
    $env:PGPASSWORD=$previousPassword
    $env:PGCONNECT_TIMEOUT=$previousTimeout
    $ErrorActionPreference=$previousPreference
  }
}
function Test-PostgresLogin {
  $result=Invoke-PostgresTool 'psql.exe' ($connection+@('-X','-qAt','-v','ON_ERROR_STOP=1','-c','SELECT 1;'))
  if (($result | Out-String).Trim() -ne '1') { throw 'PostgreSQL did not return the expected health response.' }
}

switch ($Action) {
  'check' { Test-PostgresLogin; Write-Host ('PostgreSQL ready: local port '+$database.RESEARCH_DATABASE_PORT+'.') }
  'status' { Test-PostgresLogin; Write-Host ('PostgreSQL ready: '+$database.RESEARCH_DATABASE_NAME+' on local port '+$database.RESEARCH_DATABASE_PORT+'.') }
  'backup' {
    Test-PostgresLogin
    if (!$ArchivePath) { throw 'A PostgreSQL backup destination is required.' }
    $destination=[IO.Path]::GetFullPath($ArchivePath)
    if (!$destination.StartsWith($ProjectRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'The database backup must remain inside this project.' }
    if (Test-Path -LiteralPath $destination) { throw 'The database backup destination already exists.' }
    New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
    Invoke-PostgresTool 'pg_dump.exe' ($connection+@('--format=custom','--no-owner','--no-privileges','--exclude-schema=qa_pg_*','--file',$destination)) | Out-Null
    Invoke-PostgresTool 'pg_restore.exe' @('--list',$destination) | Out-Null
    Write-Host 'PostgreSQL backup created and validated.'
  }
  'restore' {
    Test-PostgresLogin
    if (!$ArchivePath) { throw 'A PostgreSQL backup file is required.' }
    $archive=(Resolve-Path -LiteralPath $ArchivePath).Path
    Invoke-PostgresTool 'pg_restore.exe' @('--list',$archive) | Out-Null
    Invoke-PostgresTool 'pg_restore.exe' ($connection+@('--clean','--if-exists','--no-owner','--no-privileges','--single-transaction',$archive)) | Out-Null
    Write-Host 'PostgreSQL backup restored.'
  }
  'ResetLegacy' {
    Test-PostgresLogin
    # Clear only this application's explicit table set. No DROP SCHEMA or
    # CASCADE is used, so unrelated dependent objects cause a safe failure.
    $names=@('research_workspace','research_papers','research_paper_pages','research_notes','research_annotations','research_concepts','research_graph_nodes','research_graph_edges','research_note_versions','research_review_decks','research_planner_tasks','research_runs')
    $literals=($names | ForEach-Object { "'"+$_+"'" }) -join ','
    $sql=@'
DO $reset$
DECLARE relation_names text; selected_schema text := '__SCHEMA__';
BEGIN
  SELECT string_agg(format('%I.%I',selected_schema,n),',') INTO relation_names
  FROM unnest(ARRAY[__TABLES__]) AS n
  WHERE to_regclass(format('%I.%I',selected_schema,n)) IS NOT NULL;
  IF relation_names IS NOT NULL THEN EXECUTE 'TRUNCATE TABLE ' || relation_names; END IF;
  IF to_regclass(format('%I.research_migrations',selected_schema)) IS NOT NULL THEN
    EXECUTE format('DELETE FROM %I.research_migrations WHERE id=$1',selected_schema) USING 'legacy-files-v1';
  END IF;
END $reset$;
'@
    $sql=$sql.Replace('__SCHEMA__',$Schema).Replace('__TABLES__',$literals)
    Invoke-PostgresTool 'psql.exe' ($connection+@('-X','-q','-v','ON_ERROR_STOP=1','--single-transaction','-c',$sql)) | Out-Null
    Write-Host 'Research tables prepared for import from the restored legacy files.'
  }
}
