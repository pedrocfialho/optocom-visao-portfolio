#Requires -Version 7.4
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9]{20}$')][string]$ProjectRef,
    [Parameter(Mandatory)][string]$SessionPoolerHost,
    [Parameter(Mandatory)][string]$PostgresBin,
    [Parameter(Mandatory)][string]$RecoveryKeyPath,
    [string]$OneDriveDirectory,
    [string]$ConfigPath
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Backup.Common.psm1') -Force
$state = Get-BackupStateDirectory
if (-not $ConfigPath) { $ConfigPath = Join-Path $state 'config.json' }
if (Test-Path -LiteralPath $ConfigPath) { throw 'Configuração já existente. Não será sobrescrita. Para trocar a senha, use Update-BackupPassword.ps1.' }
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$config = Get-Content (Join-Path $PSScriptRoot 'backup.config.example.json') -Raw | ConvertFrom-Json
$config.ProjectRef = $ProjectRef
$config.Host = $SessionPoolerHost
$config.Username = 'postgres.' + $ProjectRef
Assert-BackupSource $config
Get-PostgresTools $PostgresBin | Out-Null
Get-Command New-SelfSignedCertificate,Export-PfxCertificate -ErrorAction Stop | Out-Null
if (-not $OneDriveDirectory) {
    $oneDrive = if ($env:OneDriveCommercial) { $env:OneDriveCommercial } else { $env:OneDrive }
    if (-not $oneDrive) { throw 'OneDrive não encontrado. Informe -OneDriveDirectory com uma pasta sincronizada fora do projeto.' }
    $OneDriveDirectory = Join-Path $oneDrive $config.OneDriveSubdirectory
}
$primary = Join-Path $project 'backups/database'
Assert-BackupDestinations $project $primary $OneDriveDirectory
$recovery = [IO.Path]::GetFullPath($RecoveryKeyPath)
foreach ($forbidden in @($project, $state, $OneDriveDirectory)) {
    $root = [IO.Path]::GetFullPath($forbidden).TrimEnd('\','/')
    if ($recovery.Equals($root, [StringComparison]::OrdinalIgnoreCase) -or $recovery.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Guarde a chave de recuperação fora do projeto, do estado local e das pastas de backup; prefira mídia externa.' }
}
if (Test-Path -LiteralPath $recovery) { throw 'O arquivo de recuperação já existe e não será sobrescrito.' }
if (-not (Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($recovery)) -PathType Container)) { throw 'Crie/conecte primeiro a pasta de destino da chave de recuperação.' }
if (-not $PSCmdlet.ShouldProcess('Configuração local, certificado e chave de recuperação', 'Preparar backup; solicitar senhas somente neste terminal')) { return }
Set-PrivateDirectory $state | Out-Null
$rootPath = Join-Path $state 'roots.pem'
Write-PostgresRootBundle $rootPath
$cert = $null; $password = $null; $keyPassword = $null
try {
    $password = Read-Host 'Senha PostgreSQL do seu projeto de demonstração (entrada oculta)' -AsSecureString
    if ($password.Length -eq 0) { throw 'Senha vazia recusada.' }
    $keyPassword = Read-Host 'Nova senha FORTE para proteger o PFX de recuperação; guarde-a separadamente' -AsSecureString
    if ($keyPassword.Length -lt 16) { throw 'Use pelo menos 16 caracteres para proteger a chave de recuperação.' }
    $cert = New-SelfSignedCertificate -Subject 'CN=OPTOCOM Portfolio Backup' -CertStoreLocation Cert:/CurrentUser/My -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy ExportableEncrypted -KeyUsage DigitalSignature,KeyEncipherment -Provider 'Microsoft Software Key Storage Provider' -NotAfter (Get-Date).AddYears(10)
    Export-PfxCertificate -Cert $cert -FilePath $recovery -Password $keyPassword -CryptoAlgorithmOption AES256_SHA256 | Out-Null
    $checkKey = [Security.Cryptography.X509Certificates.X509Certificate2]::new($recovery,$keyPassword,[Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
    try { if (-not $checkKey.HasPrivateKey -or $checkKey.Thumbprint -ne $cert.Thumbprint) { throw 'Não foi possível verificar a chave exportada.' } }
    finally { $checkKey.Dispose() }
    $credentialPath = Join-Path $state 'database.credential.xml'
    [pscredential]::new($config.Username,$password) | Export-Clixml -LiteralPath $credentialPath
    $extra = @{
        ProjectDirectory=$project; BackupDirectory=$primary; OneDriveDirectory=[IO.Path]::GetFullPath($OneDriveDirectory)
        PostgresBin=[IO.Path]::GetFullPath($PostgresBin); CredentialPath=$credentialPath
        RootCertificatePath=$rootPath; CertificateThumbprint=$cert.Thumbprint; RecoveryKeyExported=$true
        StateDirectory=$state; LogPath=(Join-Path $state 'backup.log.jsonl')
    }
    foreach ($key in $extra.Keys) { $config | Add-Member -NotePropertyName $key -NotePropertyValue $extra[$key] }
    $config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ConfigPath -Encoding utf8
    Write-Output 'Configuração preparada. Nenhum backup executado e nenhuma tarefa registrada. A mídia com o PFX pode ser removida com segurança e guardada offline; a rotina usará o certificado instalado no Windows. Guarde a senha do PFX separadamente.'
} finally {
    if ($password) { $password.Dispose() }
    if ($keyPassword) { $keyPassword.Dispose() }
}
