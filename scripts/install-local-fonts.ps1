param([Parameter(Mandatory=$true)][string]$ArchivePath)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fontDirectory=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts'))
$temporary=Join-Path $projectRoot ('tmp\font-install\'+[Guid]::NewGuid().ToString('N'))
$registry='HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts'
$fonts=@(
  @{file='Michelangelus-Regular.ttf';name='Michelangelus Regular';hash='8E21078B09F6BEFA90ECE78B55B8140D4A3B778EB48E68A7C899E02074429A4A'},
  @{file='Michelangelus-Bold.ttf';name='Michelangelus Bold';hash='C5F07EB1D008B2AD1F75A9B5E8F91BA45827EF2B6D0F6989D0371A6168E1125F'},
  @{file='Michelangelus-Italic.ttf';name='Michelangelus Italic';hash='36EF7B5A9A1F25C29C8AD3478D649FBA2F64549BC50AAB165DC55FB4418741DA'},
  @{file='Michelangelus-BoldItalic.ttf';name='Michelangelus Bold Italic';hash='F4815C2E4212BE963D24C913C689DD2A97DC607E0E9FF0587F2AB90AD2641A52'}
)
Add-Type -AssemblyName System.IO.Compression.FileSystem
New-Item -ItemType Directory -Path $temporary,$fontDirectory,(Join-Path $projectRoot 'reports') -Force | Out-Null
$archive=[IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ArchivePath).Path)
try {
  # Extract only the four verified font records; no archived paths or programs run.
  foreach ($font in $fonts) {
    $entries=@($archive.Entries | Where-Object { $_.FullName -ceq $font.file })
    if ($entries.Count -ne 1) { throw ('Missing or ambiguous font: '+$font.file) }
    $extracted=Join-Path $temporary $font.file
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entries[0],$extracted)
    if ((Get-FileHash -LiteralPath $extracted -Algorithm SHA256).Hash -ne $font.hash) { throw ('Font checksum mismatch: '+$font.file) }
  }
} finally { $archive.Dispose() }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ResearchFontInstall {
  [DllImport("gdi32.dll", CharSet=CharSet.Unicode)]
  public static extern int AddFontResourceEx(string filename, uint flags, IntPtr reserved);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
}
'@
$registryBackup=$null
$existingNames=@()
if (Test-Path -LiteralPath $registry) {
  $existingKey=Get-Item -LiteralPath $registry
  $existingNames=@($existingKey.GetValueNames())
  $existingValues=@($existingNames | ForEach-Object { [pscustomobject]@{name=$_;value=$existingKey.GetValue($_);kind=$existingKey.GetValueKind($_).ToString()} })
  $registryBackup=Join-Path $projectRoot ('reports\font-registry-before-'+[Guid]::NewGuid().ToString('N')+'.json')
  [IO.File]::WriteAllText($registryBackup,($existingValues|ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
} else { New-Item -Path $registry | Out-Null }
$installed=@()
foreach ($font in $fonts) {
  $destination=[IO.Path]::GetFullPath((Join-Path $fontDirectory $font.file))
  if (!$destination.StartsWith($fontDirectory+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid font destination.' }
  if (Test-Path -LiteralPath $destination) {
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $font.hash) { throw ('A different installed version was preserved: '+$font.file) }
  } else { Copy-Item -LiteralPath (Join-Path $temporary $font.file) -Destination $destination }
  New-ItemProperty -Path $registry -Name ($font.name+' (TrueType)') -Value $destination -PropertyType String -Force | Out-Null
  $added=[ResearchFontInstall]::AddFontResourceEx($destination,0,[IntPtr]::Zero)
  $installed += [pscustomobject]@{name=$font.name;path=$destination;sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash;loaded=($added -gt 0)}
}
$broadcastResult=[IntPtr]::Zero
[void][ResearchFontInstall]::SendMessageTimeout([IntPtr]0xffff,0x001d,[IntPtr]::Zero,[IntPtr]::Zero,2,1000,[ref]$broadcastResult)
$song=Join-Path $env:WINDIR 'Fonts\STSONG.TTF'
$remainingNames=@((Get-Item -LiteralPath $registry).GetValueNames())
$preserved=@($existingNames | Where-Object { $_ -notin $remainingNames }).Count -eq 0
$report=[ordered]@{verifiedAt=[DateTime]::UtcNow.ToString('o');scope='current Windows user';fonts=$installed;stSongAlreadyInstalled=(Test-Path -LiteralPath $song);stSongPath=$song;registryBackup=$registryBackup;existingRegistrationsPreserved=$preserved;publicFontFilesAdded=0;passed=(@($installed | Where-Object { !$_.loaded }).Count -eq 0 -and (Test-Path -LiteralPath $song) -and $preserved)}
[IO.File]::WriteAllText((Join-Path $projectRoot 'reports\local-font-installation.json'),($report|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
$report|ConvertTo-Json -Depth 5
