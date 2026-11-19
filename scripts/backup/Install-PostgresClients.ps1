#Requires -Version 7.4
[CmdletBinding(SupportsShouldProcess)]
param()
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Backup.Common.psm1') -Force
# Distribuição Windows x64 publicada na página oficial EDB de binários PostgreSQL 17.
# Somente clientes e DLLs; não instala/inicia servidor nem serviço do Windows.
$uri = 'https://get.enterprisedb.com/postgresql/postgresql-17.11-5-windows-x64-binaries.zip'
$root = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.optocom-portfolio/Tools/PostgreSQL17'
$bin = Join-Path $root 'bin'
if (Test-Path -LiteralPath $bin) {
    Get-PostgresTools $bin | Out-Null
    Write-Output ('Clientes já disponíveis: ' + $bin)
    return
}
if (-not $PSCmdlet.ShouldProcess($root,'Baixar pacote oficial PostgreSQL 17 e extrair somente clientes e bibliotecas')) { return }
Set-PrivateDirectory $root | Out-Null
$zip = Join-Path $root ('download-' + [guid]::NewGuid().ToString('N') + '.zip')
$archive = $null
try {
    Invoke-WebRequest -Uri $uri -OutFile $zip
    Write-Output ('SHA256 do pacote obtido por HTTPS: ' + (Get-FileHash -LiteralPath $zip).Hash)
    $archive = [IO.Compression.ZipFile]::OpenRead($zip)
    $clients = @('pg_dump.exe','pg_dumpall.exe','pg_restore.exe','psql.exe')
    $entries = @($archive.Entries | Where-Object { $_.FullName -match '^pgsql/bin/[^/]+$' -and ($_.Name -in $clients -or $_.Name.EndsWith('.dll',[StringComparison]::OrdinalIgnoreCase)) })
    if (@($entries | Where-Object Name -in $clients).Count -ne 4) { throw 'O pacote não contém os quatro clientes esperados.' }
    [IO.Directory]::CreateDirectory($bin) | Out-Null
    foreach ($entry in $entries) { [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,(Join-Path $bin $entry.Name),$false) }
    Get-PostgresTools $bin | Out-Null
    Write-Output ('Clientes PostgreSQL 17 instalados, sem servidor: ' + $bin)
} finally {
    if ($archive) { $archive.Dispose() }
    if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
}
