#Requires -Version 7.4
[CmdletBinding(SupportsShouldProcess)]
param([string]$ConfigPath, [switch]$Scheduled)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Backup.Common.psm1') -Force
$config = if ($ConfigPath) { Get-BackupConfig $ConfigPath } else { Get-BackupConfig }
$tools = Get-PostgresTools $config.PostgresBin
$cert = Get-BackupCertificate $config.CertificateThumbprint
# Confirma somente que a exportação inicial foi concluída. Não lê o PFX nem verifica a mídia externa.
# Assinatura, criptografia e verificação usam o certificado instalado em CurrentUser/My.
if (-not $config.RecoveryKeyExported) { throw 'Exporte primeiro a chave privada de recuperação.' }
if (-not $PSCmdlet.ShouldProcess('OPTOCOM-Visao', 'Ler banco e criar duas cópias criptografadas; reter diários de 30 dias e mensais de 12 meses')) { return }
Set-PrivateDirectory $config.StateDirectory | Out-Null
$work = $null; $verification = $null; $credential = $null; $lock = $null
$name = New-BackupFileName; $result = 'backup_failed'; $partial = $null; $externalPartial = $null
try {
    try { $lock = [IO.File]::Open((Join-Path $config.StateDirectory 'backup.lock'),'OpenOrCreate','ReadWrite','None') }
    catch [IO.IOException] { Write-BackupEvent $config.LogPath 'skipped_running' ''; return }
    if ($Scheduled -and -not (Test-ScheduledBackupDue $config.LogPath)) { Write-BackupEvent $config.LogPath 'skipped_current' ''; return }
    $credential = Import-Clixml -LiteralPath $config.CredentialPath
    if ($credential -isnot [pscredential] -or $credential.UserName -ne $config.Username) { throw 'Credencial local incompatível.' }
    $work = New-BackupWorkDirectory $config.StateDirectory
    $raw = Join-Path $work 'raw'; [IO.Directory]::CreateDirectory($raw) | Out-Null
    $common = @{ Credential=$credential; Connection=$config; RootCertificatePath=$config.RootCertificatePath }
    $server = Invoke-PostgresTool -Executable $tools.psql -Arguments @('--no-password','--no-psqlrc','--tuples-only','--no-align','--command','SHOW server_version;') @common
    if ($server.Trim() -notmatch '^17\.') { throw 'Versão remota diferente de PostgreSQL 17; revise os clientes antes de continuar.' }
    # Um único snapshot inclui dados, funções, triggers, políticas, permissões e sequências.
    $dumpArgs = @('--no-password','--format=custom','--compress=6','--file',(Join-Path $raw 'database.dump'))
    foreach ($schema in @('public','auth','storage','supabase_migrations')) { $dumpArgs += '--schema=' + $schema }
    Invoke-PostgresTool -Executable $tools.pg_dump -Arguments $dumpArgs @common | Out-Null
    Invoke-PostgresTool -Executable $tools.pg_dumpall -Arguments @('--no-password','--roles-only','--no-role-passwords','--file',(Join-Path $raw 'roles.sql')) @common | Out-Null
    $list = Invoke-PostgresTool -Executable $tools.pg_restore -Arguments @('--list',(Join-Path $raw 'database.dump'))
    if ($list -notmatch 'TABLE public users_profile' -or $list -notmatch 'TABLE public patients') { throw 'O arquivo não contém as tabelas esperadas.' }
    [IO.File]::WriteAllText((Join-Path $raw 'restore.list'), $list)
    $hashes = @{}
    foreach ($file in @('database.dump','roles.sql','restore.list')) { $hashes[$file] = (Get-FileHash -LiteralPath (Join-Path $raw $file) -Algorithm SHA256).Hash }
    @{ FormatVersion=1; ProjectRef=$config.ProjectRef; CreatedAt=(Get-ClinicNow).ToString('o'); ServerVersion=$server.Trim(); Schemas=@('public','auth','storage','supabase_migrations'); Sha256=$hashes } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $raw 'manifest.json') -Encoding utf8
    $zip = Join-Path $work 'package.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($raw,$zip,[IO.Compression.CompressionLevel]::Optimal,$false)
    [IO.Directory]::CreateDirectory($config.BackupDirectory) | Out-Null
    $final = Join-Path $config.BackupDirectory $name; $partial = $final + '.partial'
    Protect-BackupPackage $zip $partial $cert
    $verification = New-BackupWorkDirectory $config.StateDirectory
    Expand-VerifiedBackup $partial $verification $cert -ExpectedProjectRef $config.ProjectRef | Out-Null
    Move-Item -LiteralPath $partial -Destination $final
    $result = 'copy_failed'
    [IO.Directory]::CreateDirectory($config.OneDriveDirectory) | Out-Null
    $external = Join-Path $config.OneDriveDirectory $name; $externalPartial = $external + '.partial'
    Copy-Item -LiteralPath $final -Destination $externalPartial
    if ((Get-FileHash -LiteralPath $final).Hash -ne (Get-FileHash -LiteralPath $externalPartial).Hash) { throw 'Falha ao verificar a segunda cópia.' }
    Move-Item -LiteralPath $externalPartial -Destination $external
    # Falha de cópia jamais dispara retenção, nem apaga o backup local recém-criado.
    $result = 'retention_failed'
    $retentionNow = Get-ClinicNow
    Invoke-BackupRetention $config.BackupDirectory -Now $retentionNow -Days $config.RetentionDays -MonthlyMonths $config.MonthlyRetentionMonths
    Invoke-BackupRetention $config.OneDriveDirectory -Now $retentionNow -Days $config.RetentionDays -MonthlyMonths $config.MonthlyRetentionMonths
    Write-BackupEvent $config.LogPath 'success' $name
    Write-Output ('Backup verificado nas duas pastas: ' + $name + '. Confira também a sincronização do OneDrive.')
} catch {
    Write-BackupEvent $config.LogPath $result $name
    # Saída agendada também não inclui stderr SQL, dados ou caminhos de credenciais.
    Write-Error ('Backup não concluído: ' + $result + '. Nenhum comando de alteração foi enviado ao banco.') -ErrorAction Continue
    exit 1
} finally {
    if ($credential) { $credential.Password.Dispose() }
    foreach ($path in @($work,$verification)) { if ($path) { Remove-BackupWorkDirectory $path $config.StateDirectory } }
    # Somente arquivos parciais desta execução; nunca arquivos finais.
    foreach ($path in @($partial,$externalPartial)) { if ($path -and (Test-Path -LiteralPath $path)) { Remove-Item -LiteralPath $path -Force } }
    if ($lock) { $lock.Dispose() }
}
