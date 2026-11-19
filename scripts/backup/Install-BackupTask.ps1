#Requires -Version 7.4
[CmdletBinding(SupportsShouldProcess)]
param([string]$ConfigPath,[string]$XmlPath,[switch]$Register,[switch]$UpdateExisting)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Backup.Common.psm1') -Force
if (-not $ConfigPath) { $ConfigPath = Join-Path (Get-BackupStateDirectory) 'config.json' }
$config = Get-BackupConfig $ConfigPath
if (-not $XmlPath) { $XmlPath = Join-Path $config.StateDirectory 'task.xml' }
$pwsh = (Get-Process -Id $PID).Path
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$xml = New-BackupTaskXml $pwsh (Join-Path $PSScriptRoot 'Backup-Database.ps1') $ConfigPath $config.ProjectDirectory $sid
if (-not $PSCmdlet.ShouldProcess($config.TaskName,'Exportar definição de tarefa diária às 03:00')) { return }
$xml | Set-Content -LiteralPath $XmlPath -Encoding utf8
if (-not $Register) { Write-Output 'Somente XML preparado. Nenhuma tarefa criada. Use -Register após configurar e testar o primeiro backup.'; return }
if ((Get-TimeZone).Id -ne 'E. South America Standard Time') { throw 'Configure/revise o fuso do Windows para Brasília antes de registrar a tarefa.' }
Get-PostgresTools $config.PostgresBin | Out-Null
# O agendamento depende do certificado local; a mídia com o PFX pode permanecer offline.
Get-BackupCertificate $config.CertificateThumbprint | Out-Null
$credential = Import-Clixml -LiteralPath $config.CredentialPath
try { if ($credential -isnot [pscredential] -or -not $config.RecoveryKeyExported) { throw 'Configuração segura incompleta.' } }
finally { if ($credential -is [pscredential]) { $credential.Password.Dispose() } }
if ((Get-ScheduledTask -TaskName $config.TaskName -ErrorAction SilentlyContinue) -and -not $UpdateExisting) { throw 'A tarefa já existe; revise-a manualmente. Use -UpdateExisting somente para atualizar esta tarefa OPTOCOM.' }
if ($PSCmdlet.ShouldProcess($config.TaskName,'Registrar no Windows Task Scheduler sem senha da conta Windows')) {
    Register-ScheduledTask -TaskName $config.TaskName -Xml $xml -Force:$UpdateExisting | Select-Object TaskName,State
}
