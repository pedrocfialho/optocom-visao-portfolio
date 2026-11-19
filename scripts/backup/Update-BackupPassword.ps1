#Requires -Version 7.4
[CmdletBinding(SupportsShouldProcess)]
param([string]$ConfigPath)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Backup.Common.psm1') -Force
$config = if ($ConfigPath) { Get-BackupConfig $ConfigPath } else { Get-BackupConfig }
if (-not $PSCmdlet.ShouldProcess('Credencial DPAPI local', 'Atualizar senha PostgreSQL')) { return }
$password = Read-Host 'Nova senha PostgreSQL (entrada oculta)' -AsSecureString
try {
    if (-not $password.Length) { throw 'Senha vazia recusada.' }
    [pscredential]::new($config.Username,$password) | Export-Clixml -LiteralPath $config.CredentialPath
    'Senha local atualizada. Nenhuma conexão executada.'
} finally { $password.Dispose() }
