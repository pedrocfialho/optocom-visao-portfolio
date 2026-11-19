#Requires -Version 7.4
[CmdletBinding()]
param([string]$ConfigPath,[DateTimeOffset]$Now = [DateTimeOffset]::Now)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Backup.Common.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'Retention.Policy.psm1') -Force
$config = if ($ConfigPath) { Get-BackupConfig $ConfigPath } else { Get-BackupConfig }
# Simulação pura: não lê senha/certificado, não abre pacotes, não escreve ou remove arquivos.
foreach ($destination in @(@{Name='Projeto';Path=$config.BackupDirectory},@{Name='OneDrive';Path=$config.OneDriveDirectory})) {
    foreach ($entry in @(Get-BackupRetentionPlan -Directory $destination.Path -Now $Now -Days 30 -MonthlyMonths 12)) {
        [pscustomobject]@{ Destination=$destination.Name; Name=$entry.Name; Action=$entry.Action; Monthly=$entry.Monthly; Reasons=($entry.Reasons -join ', ') }
    }
}
