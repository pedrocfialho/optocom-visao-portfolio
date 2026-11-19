#Requires -Version 7.4
[CmdletBinding()]
param([Parameter(Mandatory)][string]$BackupPath,[string]$ConfigPath)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Backup.Common.psm1') -Force
$config = if ($ConfigPath) { Get-BackupConfig $ConfigPath } else { Get-BackupConfig }
$cert = Get-BackupCertificate $config.CertificateThumbprint
$work = New-BackupWorkDirectory $config.StateDirectory
try {
    $content = Expand-VerifiedBackup $BackupPath $work $cert -ExpectedProjectRef $config.ProjectRef
    $tools = Get-PostgresTools $config.PostgresBin
    Invoke-PostgresTool -Executable $tools.pg_restore -Arguments @('--list',(Join-Path $content.Directory 'database.dump')) | Out-Null
    [pscustomobject]@{ File=[IO.Path]::GetFileName($BackupPath); Result='verified'; CreatedAt=$content.Manifest.CreatedAt; ProjectRef=$content.Manifest.ProjectRef }
} finally { Remove-BackupWorkDirectory $work $config.StateDirectory }
