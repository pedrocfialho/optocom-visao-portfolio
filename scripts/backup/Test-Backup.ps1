#Requires -Version 7.4
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Backup.Common.psm1') -Force
$script:checks = 0
function Assert($condition,[string]$message) { if (-not $condition) { throw $message }; $script:checks++ }
function Assert-Throws([scriptblock]$action,[string]$message) { $threw=$false; try { & $action | Out-Null } catch { $threw=$true }; Assert $threw $message }
foreach ($file in Get-ChildItem -LiteralPath $PSScriptRoot -File | Where-Object Extension -in '.ps1','.psm1') {
    $tokens=$null; $errors=$null
    [Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors) | Out-Null
    Assert ($errors.Count -eq 0) ('Sintaxe: ' + $file.Name + ' ' + ($errors.Message -join '; '))
}
# Não conecta ao Supabase, não usa credenciais reais, não registra tarefas e não persiste certificados.
$state = Join-Path ([IO.Path]::GetTempPath()) ('optocom-tests-' + [guid]::NewGuid().ToString('N'))
$work = $null; $rsa=$null; $cert=$null; $other=$null; $otherRsa=$null
try {
    $work = New-BackupWorkDirectory $state
    $rsa = [Security.Cryptography.RSA]::Create(2048)
    $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Ephemeral backup test',$rsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $cert = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays(-1),[DateTimeOffset]::UtcNow.AddDays(1))
    # Simula a exportação e a retirada da mídia de emergência antes da rotina diária.
    # Certificado efêmero e senha sintética: nenhum certificado real do Windows é alterado.
    $offlineKey=Join-Path $work 'offline-key.pfx'
    [IO.File]::WriteAllBytes($offlineKey,$cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Pkcs12,'synthetic-recovery-test-only'))
    Remove-Item -LiteralPath $offlineKey
    Assert (-not (Test-Path -LiteralPath $offlineKey)) 'O PFX externo deve estar ausente durante os testes de assinatura, criptografia e verificação seguintes.'
    $otherRsa=[Security.Cryptography.RSA]::Create(2048)
    $request2=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Wrong test key',$otherRsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $other=$request2.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays(-1),[DateTimeOffset]::UtcNow.AddDays(1))
    $raw=Join-Path $work 'raw'; [IO.Directory]::CreateDirectory($raw) | Out-Null
    $hashes=@{}
    foreach ($file in @('database.dump','roles.sql','restore.list')) {
        [IO.File]::WriteAllText((Join-Path $raw $file),'SYNTHETIC LOCAL TEST ONLY')
        $hashes[$file]=(Get-FileHash -LiteralPath (Join-Path $raw $file)).Hash
    }
    @{ FormatVersion=1;ProjectRef='abcdefghijklmnopqrst';Sha256=$hashes } | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $raw 'manifest.json')
    $zip=Join-Path $work 'input.zip'; $encrypted=Join-Path $work 'output.zip.p7m'
    [IO.Compression.ZipFile]::CreateFromDirectory($raw,$zip)
    Protect-BackupPackage $zip $encrypted $cert
    Assert (([IO.File]::ReadAllText($encrypted)) -notmatch 'SYNTHETIC LOCAL TEST ONLY') 'Não deve expor conteúdo em claro.'
    $verify=New-BackupWorkDirectory $state
    try { $result=Expand-VerifiedBackup $encrypted $verify $cert -ExpectedProjectRef abcdefghijklmnopqrst; Assert (Test-Path (Join-Path $result.Directory 'database.dump')) 'Pacote válido deve ser recuperável.' }
    finally { Remove-BackupWorkDirectory $verify $state }
    $verify=New-BackupWorkDirectory $state
    try { Assert-Throws { Expand-VerifiedBackup $encrypted $verify $cert -ExpectedProjectRef zyxwvutsrqponmlkjihg } 'Outro projeto de origem deve ser recusado.' } finally { Remove-BackupWorkDirectory $verify $state }
    $source=[pscustomobject]@{ProjectRef='abcdefghijklmnopqrst';Host='aws-0-example-1.pooler.supabase.com';Port=5432;Database='postgres';Username='postgres.abcdefghijklmnopqrst'}
    Assert-BackupSource $source
    $source.Username='postgres.outro'
    Assert-Throws { Assert-BackupSource $source } 'Usuário deve corresponder ao projeto configurado.'
    $source.Username='postgres.abcdefghijklmnopqrst';$source.Host='untrusted.invalid'
    Assert-Throws { Assert-BackupSource $source } 'Host fora do pooler deve ser recusado.'
    Assert-Throws { Unprotect-BackupPackage $encrypted (Join-Path $work 'wrong.zip') $other } 'Certificado errado deve falhar.'
    $bytes=[IO.File]::ReadAllBytes($encrypted); $bytes[$bytes.Length-10]=$bytes[$bytes.Length-10] -bxor 1
    $tampered=Join-Path $work 'tampered.p7m'; [IO.File]::WriteAllBytes($tampered,$bytes)
    Assert-Throws { Unprotect-BackupPackage $tampered (Join-Path $work 'tampered.zip') $cert } 'Alteração no pacote deve falhar.'
    [IO.File]::WriteAllText((Join-Path $raw 'database.dump'),'CHANGED')
    $badZip=Join-Path $work 'bad.zip';[IO.Compression.ZipFile]::CreateFromDirectory($raw,$badZip)
    $badEncrypted=Join-Path $work 'bad.p7m';Protect-BackupPackage $badZip $badEncrypted $cert
    $verify=New-BackupWorkDirectory $state
    try { Assert-Throws { Expand-VerifiedBackup $badEncrypted $verify $cert -ExpectedProjectRef abcdefghijklmnopqrst } 'Hash inválido deve falhar.' }
    finally { Remove-BackupWorkDirectory $verify $state }
    $directory=Join-Path $work 'retention';[IO.Directory]::CreateDirectory($directory)|Out-Null
    foreach ($name in @('optocom_backup_2026-08-01_030000_12345678.zip.p7m','optocom_backup_2026-08-02_030000_12345678.zip.p7m','unrelated.sql')) { [IO.File]::WriteAllText((Join-Path $directory $name),'test') }
    $now=[DateTimeOffset]::Parse('2026-11-03T12:00:00-03:00')
    $candidates=@(Get-RetentionCandidates $directory $now)
    Assert ($candidates.Count -eq 1 -and $candidates[0].Name -match '08-01') 'Deve preservar o mais recente mesmo quando todos têm mais de 30 dias.'
    Invoke-BackupRetention $directory $now
    Assert (Test-Path (Join-Path $directory 'unrelated.sql')) 'Não deve apagar arquivos alheios.'
    Assert (Test-Path (Join-Path $directory 'optocom_backup_2026-08-02_030000_12345678.zip.p7m')) 'Backup mais recente preservado.'
    $log=Join-Path $work 'test.jsonl'
    Write-BackupEvent $log 'success' 'only-name.p7m' $now
    $entry=Get-Content $log | ConvertFrom-Json
    Assert (($entry.PSObject.Properties.Name | Sort-Object) -join ',' -eq 'file,result,timestamp') 'Log somente com campos aprovados.'
    Assert-Throws { Write-BackupEvent $log 'success' 'C:/secret/file' } 'Log deve recusar caminhos.'
    Assert (-not (Test-ScheduledBackupDue $log $now)) 'Não repetir execução concluída no período.'
    Write-BackupEvent $log 'skipped_current' '' $now
    Assert (@([IO.File]::ReadAllLines($log)).Count -eq 2) 'A consulta do período deve liberar o log para a gravação imediatamente seguinte.'
    Assert (Test-ScheduledBackupDue $log $now.AddDays(1)) 'Dia seguinte precisa de backup.'
    [xml]$xml=New-BackupTaskXml 'C:/Program Files/pwsh.exe' 'C:/app/Backup.ps1' 'C:/state/config.json' 'C:/app' 'S-1-5-21-123' ([datetime]'2026-11-04')
    Assert ($xml.Task.Settings.StartWhenAvailable -eq 'true') 'Executar quando disponível.'
    Assert ($xml.Task.Principals.Principal.LogonType -eq 'InteractiveToken') 'Não armazenar senha Windows na tarefa.'
    Assert ($xml.Task.Triggers.CalendarTrigger.StartBoundary -eq '2026-11-04T03:00:00') 'Horário 03:00.'
    Assert ($xml.Task.Triggers.LogonTrigger.UserId -eq 'S-1-5-21-123') 'Recuperar execução ao entrar no Windows.'
    Assert-Throws { Remove-BackupWorkDirectory $PSScriptRoot $state } 'Limpeza fora do staging recusada.'
    Assert-Throws { Assert-BackupDestinations 'C:/project' 'C:/project/backups/database' 'C:/project/copy' } 'Cópia externa não pode ficar dentro do projeto.'
    $processCredential=[pscredential]::new('synthetic-user',(ConvertTo-SecureString 'synthetic-not-a-real-password' -AsPlainText -Force))
    try {
        $processArgs=@('-NoProfile','-NonInteractive','-Command',"if (`$env:PGPASSWORD -eq 'synthetic-not-a-real-password' -and `$env:PGOPTIONS -eq '-c default_transaction_read_only=on' -and `$env:PGSSLMODE -eq 'verify-full') { 'child-environment-ok' } else { exit 9 }")
        $processConnection=[pscustomobject]@{Host='no-network-used.invalid';Port=5432;Database='synthetic'}
        $value=Invoke-PostgresTool -Executable (Get-Process -Id $PID).Path -Arguments $processArgs -Credential $processCredential -Connection $processConnection -RootCertificatePath 'not-used.pem'
        Assert ($value.Trim() -eq 'child-environment-ok') 'Credencial somente no processo filho; TLS e modo leitura definidos.'
        Assert (-not $env:PGPASSWORD) 'Senha não deve atingir o ambiente pai.'
        $errorText=''
        try { Invoke-PostgresTool -Executable (Get-Process -Id $PID).Path -Arguments @('-NoProfile','-NonInteractive','-Command',"[Console]::Error.Write(`$env:PGPASSWORD);exit 7") -Credential $processCredential -Connection $processConnection -RootCertificatePath 'not-used.pem' | Out-Null }
        catch { $errorText=$_.Exception.Message }
        Assert ($errorText -match 'código 7' -and $errorText -notmatch 'synthetic-not-a-real-password' -and $errorText -match 'OCULTADA') 'Falha preserva código e oculta senha no diagnóstico.'
    } finally { $processCredential.Password.Dispose() }
    'PASS: ' + $script:checks + ' verificações locais; nenhum acesso ao banco ou criação de tarefa.'
} finally {
    if ($cert) { $cert.Dispose() }; if ($other) { $other.Dispose() }
    if ($rsa) { $rsa.Dispose() }; if ($otherRsa) { $otherRsa.Dispose() }
    if ($work) { Remove-BackupWorkDirectory $work $state }
    # Não há remoção recursiva de $state; somente duas pastas vazias com caminho exato.
    if (Test-Path -LiteralPath (Join-Path $state 'staging')) { [IO.Directory]::Delete((Join-Path $state 'staging')) }
    if (Test-Path -LiteralPath $state) { [IO.Directory]::Delete($state) }
}
