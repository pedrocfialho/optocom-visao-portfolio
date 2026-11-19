#Requires -Version 7.4
[CmdletBinding(SupportsShouldProcess,ConfirmImpact='High')]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9]{20}$')][string]$SourceProjectRef,
    [Parameter(Mandatory)][string]$BackupPath,
    [Parameter(Mandatory)][string]$CertificateThumbprint,
    [Parameter(Mandatory)][string]$PostgresBin,
    [string]$ExportRestoreList,
    [switch]$Execute,
    [string]$ReviewedRestoreList,
    [string]$TargetProjectRef,
    [string]$TargetHost,
    [string]$TargetUsername
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Backup.Common.psm1') -Force
$state = Get-BackupStateDirectory
$cert = Get-BackupCertificate $CertificateThumbprint
$tools = Get-PostgresTools $PostgresBin
$work = New-BackupWorkDirectory $state
$password = $null
try {
    $content = Expand-VerifiedBackup $BackupPath $work $cert -ExpectedProjectRef $SourceProjectRef
    $archive = Join-Path $content.Directory 'database.dump'
    $list = Invoke-PostgresTool -Executable $tools.pg_restore -Arguments @('--list',$archive)
    if ($ExportRestoreList) {
        if (Test-Path -LiteralPath $ExportRestoreList) { throw 'A lista de recuperação já existe e não será sobrescrita.' }
        if ($PSCmdlet.ShouldProcess($ExportRestoreList,'Exportar somente catálogo de objetos, sem dados')) { [IO.File]::WriteAllText([IO.Path]::GetFullPath($ExportRestoreList),$list) }
    }
    if (-not $Execute) { Write-Output 'Pacote íntegro. Modo de inspeção: nenhuma conexão ou restauração executada. Revise o catálogo e siga docs/backup.md.'; return }
    # Recuperação apenas em OUTRO projeto Supabase novo. Nunca substitui o banco de origem.
    if ($TargetProjectRef -notmatch '^[a-z0-9]{20}$' -or $TargetProjectRef -eq $SourceProjectRef) { throw 'Informe a referência de OUTRO projeto Supabase novo; restauração na origem bloqueada.' }
    if ($TargetHost -notmatch '^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$' -or $TargetUsername -ne ('postgres.' + $TargetProjectRef)) { throw 'Use os parâmetros reais do Session Pooler do novo projeto Supabase.' }
    if (-not $ReviewedRestoreList -or -not (Test-Path -LiteralPath $ReviewedRestoreList -PathType Leaf)) { throw 'É obrigatória uma lista de objetos revisada para evitar conflitos com os schemas gerenciados pelo Supabase.' }
    $original = @($list -split '\r?\n' | Where-Object { $_.Trim() -and -not $_.StartsWith(';') })
    $reviewed = @(Get-Content -LiteralPath $ReviewedRestoreList | Where-Object { $_.Trim() -and -not $_.StartsWith(';') })
    if (-not $reviewed.Count -or @($reviewed | Where-Object { $_ -notin $original }).Count -gt 0) { throw 'A lista revisada deve conter somente entradas originais do catálogo.' }
    if (-not $PSCmdlet.ShouldProcess($TargetProjectRef,'RESTAURAR banco: somente projeto novo, lista revisada e transação única')) { return }
    if ((Read-Host 'Digite a referência do NOVO projeto para confirmar') -cne $TargetProjectRef) { throw 'Confirmação divergente.' }
    $password = Read-Host 'Senha PostgreSQL do NOVO projeto (entrada oculta)' -AsSecureString
    if (-not $password.Length) { throw 'Senha vazia recusada.' }
    $credential = [pscredential]::new($TargetUsername,$password)
    $connection = [pscustomobject]@{ Host=$TargetHost; Port=5432; Database='postgres' }
    $roots = Join-Path $work 'roots.pem'
    Write-PostgresRootBundle $roots
    $common = @{ Credential=$credential; Connection=$connection; RootCertificatePath=$roots }
    $checkSql = "select current_setting('server_version_num')::int / 10000, (select count(*) from auth.users), (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','S'));"
    $check = Invoke-PostgresTool -Executable $tools.psql -Arguments @('--no-password','--no-psqlrc','--tuples-only','--no-align','--command',$checkSql) @common
    if ($check.Trim() -ne '17|0|0') { throw 'Destino recusado: exige PostgreSQL 17, zero usuários Auth e nenhuma tabela/view/sequência em public.' }
    # Sem --clean, DROP ou criação automática de roles. DDL gerenciado precisa ser excluído na revisão.
    $sql = Join-Path $work 'restore.sql'
    Invoke-PostgresTool -Executable $tools.pg_restore -Arguments @('--no-owner','--use-list',[IO.Path]::GetFullPath($ReviewedRestoreList),'--file',$sql,$archive) | Out-Null
    $prelude = Join-Path $work 'prelude.sql'
    @'
SET LOCAL session_replication_role = replica;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
'@ | Set-Content -LiteralPath $prelude -Encoding utf8
    Invoke-PostgresTool -Executable $tools.psql -Arguments @('--no-password','--no-psqlrc','--single-transaction','--set','ON_ERROR_STOP=1','--file',$prelude,'--file',$sql) -AllowWrite @common | Out-Null
    Write-Output 'Restauração concluída no NOVO projeto. Valide RLS, grants, auditoria, login e contagens antes de usar a aplicação.'
} finally {
    if ($password) { $password.Dispose() }
    Remove-BackupWorkDirectory $work $state
}
