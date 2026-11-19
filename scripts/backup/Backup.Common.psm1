#Requires -Version 7.4
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Retention.Policy.psm1') -Scope Local

function Get-BackupStateDirectory {
    if (-not $IsWindows) { throw 'Esta automação exige Windows e PowerShell 7.4 ou superior.' }
    # Fora de AppData: runtimes empacotados podem virtualizar essa pasta e ocultá-la do Agendador.
    Join-Path ([Environment]::GetFolderPath('UserProfile')) '.optocom-portfolio/Backup'
}

function Set-PrivateDirectory {
    param([Parameter(Mandatory)][string]$Path)
    $full = [IO.Path]::GetFullPath($Path)
    [IO.Directory]::CreateDirectory($full) | Out-Null
    if ((Get-Item -LiteralPath $full).LinkType) { throw 'O diretório protegido não pode ser um link.' }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($identity in @($sid, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($full), $acl)
    $full
}

function Assert-BackupSource {
    param([Parameter(Mandatory)]$Config)
    if ($Config.ProjectRef -notmatch '^[a-z0-9]{20}$' -or $Config.Host -notmatch '^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$' -or $Config.Port -ne 5432 -or $Config.Database -ne 'postgres' -or $Config.Username -cne ('postgres.' + $Config.ProjectRef)) { throw 'Origem inválida: informe explicitamente seu projeto e os parâmetros correspondentes do Session Pooler.' }
}

function Get-BackupConfig {
    param([string]$ConfigPath = (Join-Path (Get-BackupStateDirectory) 'config.json'))
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { throw 'Execute primeiro Initialize-Backup.ps1 em um terminal local seguro.' }
    $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    if ($config.Version -ne 1 -or $config.RetentionDays -ne 30 -or $config.PostgresMajor -ne 17) { throw 'Configuração de backup incompatível.' }
    if (-not $config.PSObject.Properties['MonthlyRetentionMonths']) { $config | Add-Member -NotePropertyName MonthlyRetentionMonths -NotePropertyValue 12 }
    if ($config.MonthlyRetentionMonths -ne 12) { throw 'A retenção mensal aprovada deve ser de 12 meses.' }
    Assert-BackupSource $config
    Assert-BackupDestinations $config.ProjectDirectory $config.BackupDirectory $config.OneDriveDirectory
    $config
}

function Assert-BackupDestinations {
    param([string]$ProjectDirectory, [string]$BackupDirectory, [string]$OneDriveDirectory)
    $project = [IO.Path]::GetFullPath($ProjectDirectory).TrimEnd('\','/')
    $local = [IO.Path]::GetFullPath($BackupDirectory).TrimEnd('\','/')
    $external = [IO.Path]::GetFullPath($OneDriveDirectory).TrimEnd('\','/')
    if (-not $local.Equals((Join-Path $project 'backups/database'), [StringComparison]::OrdinalIgnoreCase)) { throw 'O destino inicial deve ser backups/database dentro do projeto.' }
    if ($external.Equals($project, [StringComparison]::OrdinalIgnoreCase) -or $external.StartsWith($project + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'A cópia OneDrive precisa ficar fora da pasta principal do projeto.' }
    if ($project.StartsWith($external + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Não use uma pasta ancestral do projeto como destino de retenção.' }
}

function New-BackupWorkDirectory {
    param([Parameter(Mandatory)][string]$StateDirectory)
    $staging = Set-PrivateDirectory (Join-Path $StateDirectory 'staging')
    Set-PrivateDirectory (Join-Path $staging ('work-' + [Guid]::NewGuid().ToString('N')))
}

function Remove-BackupWorkDirectory {
    param([string]$Path, [string]$StateDirectory)
    if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return }
    $staging = [IO.Path]::GetFullPath((Join-Path $StateDirectory 'staging')).TrimEnd('\','/')
    $target = [IO.Path]::GetFullPath($Path)
    if ([IO.Path]::GetDirectoryName($target) -ne $staging -or [IO.Path]::GetFileName($target) -notmatch '^work-[0-9a-f]{32}$' -or (Get-Item -LiteralPath $target).LinkType) { throw 'Limpeza recusada: diretório temporário fora do escopo.' }
    Remove-Item -LiteralPath $target -Recurse -Force
}

function Get-BackupCertificate {
    param([Parameter(Mandatory)][string]$Thumbprint)
    $cert = Get-Item -LiteralPath ('Cert:/CurrentUser/My/' + $Thumbprint)
    if (-not $cert.HasPrivateKey -or $cert.NotAfter -lt (Get-Date) -or $cert.NotBefore -gt (Get-Date)) { throw 'Certificado de backup indisponível, sem chave privada ou fora da validade.' }
    $cert
}

function Write-PostgresRootBundle {
    param([Parameter(Mandatory)][string]$Path)
    # CA pública do serviço, obtida por HTTPS validado; não modifica os certificados do Windows.
    # URL do botão Download certificate no Dashboard oficial:
    # supabase/supabase/apps/studio/hooks/custom-content/custom-content.json
    $pem = (Invoke-WebRequest -Uri 'https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt' -TimeoutSec 30).Content
    if ($pem -is [byte[]]) { $pem = [Text.Encoding]::UTF8.GetString($pem) }
    $ca = [Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPem([string]$pem)
    try {
        $constraints = $ca.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.19' }
        if (-not $constraints.CertificateAuthority -or $ca.Subject -ne $ca.Issuer -or $ca.Subject -notmatch 'Supabase' -or $ca.NotAfter -lt (Get-Date) -or $ca.NotBefore -gt (Get-Date)) { throw 'Certificado público Supabase inválido ou fora da validade.' }
        $roots = @(Get-ChildItem Cert:/CurrentUser/Root,Cert:/LocalMachine/Root | Sort-Object Thumbprint -Unique | ForEach-Object { $_.ExportCertificatePem() })
        [IO.File]::WriteAllText([IO.Path]::GetFullPath($Path), (($roots + $ca.ExportCertificatePem()) -join "`n"))
    } finally { $ca.Dispose() }
}

function Protect-BackupPackage {
    param([string]$InputPath, [string]$OutputPath, [Security.Cryptography.X509Certificates.X509Certificate2]$Certificate)
    Add-Type -AssemblyName System.Security.Cryptography.Pkcs
    $bytes = [IO.File]::ReadAllBytes($InputPath)
    try {
        $signed = [Security.Cryptography.Pkcs.SignedCms]::new([Security.Cryptography.Pkcs.ContentInfo]::new($bytes), $false)
        $signer = [Security.Cryptography.Pkcs.CmsSigner]::new($Certificate)
        $signer.IncludeOption = [Security.Cryptography.X509Certificates.X509IncludeOption]::EndCertOnly
        $signer.DigestAlgorithm = [Security.Cryptography.Oid]::new('2.16.840.1.101.3.4.2.1')
        $signed.ComputeSignature($signer, $true)
        $algorithm = [Security.Cryptography.Pkcs.AlgorithmIdentifier]::new([Security.Cryptography.Oid]::new('2.16.840.1.101.3.4.1.42'))
        $encrypted = [Security.Cryptography.Pkcs.EnvelopedCms]::new([Security.Cryptography.Pkcs.ContentInfo]::new($signed.Encode()), $algorithm)
        $encrypted.Encrypt([Security.Cryptography.Pkcs.CmsRecipient]::new($Certificate))
        [IO.File]::WriteAllBytes($OutputPath, $encrypted.Encode())
    } finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Unprotect-BackupPackage {
    param([string]$InputPath, [string]$OutputPath, [Security.Cryptography.X509Certificates.X509Certificate2]$Certificate)
    Add-Type -AssemblyName System.Security.Cryptography.Pkcs
    $envelope = [Security.Cryptography.Pkcs.EnvelopedCms]::new()
    $envelope.Decode([IO.File]::ReadAllBytes($InputPath))
    $envelope.Decrypt([Security.Cryptography.X509Certificates.X509Certificate2Collection]::new($Certificate))
    $signed = [Security.Cryptography.Pkcs.SignedCms]::new()
    $signed.Decode($envelope.ContentInfo.Content)
    $signed.CheckSignature($true)
    if ($signed.SignerInfos.Count -ne 1 -or $signed.SignerInfos[0].Certificate.Thumbprint -ne $Certificate.Thumbprint) { throw 'A assinatura não corresponde ao certificado de recuperação esperado.' }
    [IO.File]::WriteAllBytes($OutputPath, $signed.ContentInfo.Content)
}

function Expand-VerifiedBackup {
    param([string]$BackupPath, [string]$WorkDirectory, [Security.Cryptography.X509Certificates.X509Certificate2]$Certificate, [Parameter(Mandatory)][ValidatePattern('^[a-z0-9]{20}$')][string]$ExpectedProjectRef)
    $zipPath = Join-Path $WorkDirectory 'verified.zip'
    Unprotect-BackupPackage $BackupPath $zipPath $Certificate
    $content = Join-Path $WorkDirectory 'content'
    [IO.Directory]::CreateDirectory($content) | Out-Null
    $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $expected = @('database.dump','roles.sql','restore.list','manifest.json')
        if ($archive.Entries.Count -ne 4 -or @($archive.Entries | Where-Object { $_.FullName -notin $expected }).Count -gt 0 -or @($archive.Entries.FullName | Select-Object -Unique).Count -ne 4) { throw 'Conteúdo inesperado no pacote de backup.' }
        if (($archive.Entries | Measure-Object -Property Length -Sum).Sum -gt 8GB) { throw 'Pacote excede o limite de inspeção segura.' }
        foreach ($entry in $archive.Entries) { [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $content $entry.FullName), $false) }
    } finally { $archive.Dispose() }
    $manifest = Get-Content -LiteralPath (Join-Path $content 'manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.FormatVersion -ne 1 -or $manifest.ProjectRef -cne $ExpectedProjectRef) { throw 'Manifesto incompatível com o projeto de origem esperado.' }
    foreach ($name in @('database.dump','roles.sql','restore.list')) {
        $hash = (Get-FileHash -LiteralPath (Join-Path $content $name) -Algorithm SHA256).Hash
        if ($hash -ne $manifest.Sha256.$name) { throw 'Falha de integridade no conteúdo do backup.' }
    }
    [pscustomobject]@{ Directory = $content; Manifest = $manifest }
}

function Get-PostgresTools {
    param([string]$Directory)
    $tools = @{}
    foreach ($name in @('pg_dump','pg_dumpall','pg_restore','psql')) {
        $path = Join-Path $Directory ($name + '.exe')
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw ('Cliente PostgreSQL 17 ausente: ' + $name) }
        $version = & $path --version
        if ($LASTEXITCODE -ne 0 -or $version -notmatch '\b17\.') { throw ('Exige-se cliente PostgreSQL 17: ' + $name) }
        $tools[$name] = [IO.Path]::GetFullPath($path)
    }
    $tools
}

function Invoke-PostgresTool {
    param([string]$Executable, [string[]]$Arguments, [pscredential]$Credential, $Connection, [string]$RootCertificatePath, [int]$TimeoutSeconds = 3600, [switch]$AllowWrite)
    $info = [Diagnostics.ProcessStartInfo]::new($Executable)
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    $plain = $null; $pointer = [IntPtr]::Zero; $process = $null
    try {
        if ($Credential) {
            foreach ($key in @($info.Environment.Keys | Where-Object { $_ -like 'PG*' })) { $info.Environment.Remove($key) | Out-Null }
            $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Credential.Password)
            $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
            $info.Environment['PGPASSWORD'] = $plain
            $info.Environment['PGHOST'] = [string]$Connection.Host
            $info.Environment['PGPORT'] = [string]$Connection.Port
            $info.Environment['PGDATABASE'] = [string]$Connection.Database
            $info.Environment['PGUSER'] = $Credential.UserName
            $info.Environment['PGSSLMODE'] = 'verify-full'
            $info.Environment['PGSSLROOTCERT'] = $RootCertificatePath
            $info.Environment['PGCONNECT_TIMEOUT'] = '20'
            $info.Environment['PGAPPNAME'] = if ($AllowWrite) { 'optocom-recovery' } else { 'optocom-logical-backup' }
            if (-not $AllowWrite) { $info.Environment['PGOPTIONS'] = '-c default_transaction_read_only=on' }
        }
        $process = [Diagnostics.Process]::new(); $process.StartInfo = $info
        if (-not $process.Start()) { throw 'Não foi possível iniciar a ferramenta PostgreSQL.' }
        $info.Environment.Remove('PGPASSWORD') | Out-Null
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) { $process.Kill($true); $process.WaitForExit(); throw 'Tempo limite da ferramenta PostgreSQL excedido.' }
        $stdout = $stdoutTask.GetAwaiter().GetResult(); $stderr = $stderrTask.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) {
            if ($plain) { $stderr = $stderr.Replace($plain,'[CREDENCIAL OCULTADA]') }
            throw ('Falha em ' + [IO.Path]::GetFileName($Executable) + ' (código ' + $process.ExitCode + '): ' + $stderr.Trim())
        }
        $stdout
    } finally {
        $info.Environment.Remove('PGPASSWORD') | Out-Null
        $plain = $null
        if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
        if ($process) { $process.Dispose() }
    }
}

function Get-ClinicNow {
    [TimeZoneInfo]::ConvertTime([DateTimeOffset]::UtcNow, [TimeZoneInfo]::FindSystemTimeZoneById('E. South America Standard Time'))
}

function New-BackupFileName {
    param([DateTimeOffset]$Now = (Get-ClinicNow))
    'optocom_backup_' + $Now.ToString('yyyy-MM-dd_HHmmss') + '_' + [Guid]::NewGuid().ToString('N').Substring(0,8) + '.zip.p7m'
}

function Get-RetentionCandidates {
    param([string]$Directory, [DateTimeOffset]$Now = (Get-ClinicNow), [int]$Days = 30, [int]$MonthlyMonths = 12)
    foreach ($entry in @(Get-BackupRetentionPlan -Directory $Directory -Now $Now -Days $Days -MonthlyMonths $MonthlyMonths | Where-Object Action -eq 'Remove')) {
        if (Test-Path -LiteralPath $entry.FullName -PathType Leaf) { Get-Item -LiteralPath $entry.FullName }
    }
}

function Invoke-BackupRetention {
    [CmdletBinding(SupportsShouldProcess)]
    param([string]$Directory, [DateTimeOffset]$Now = (Get-ClinicNow), [int]$Days = 30, [int]$MonthlyMonths = 12)
    $root = [IO.Path]::GetFullPath($Directory).TrimEnd('\','/')
    $plan = @(Get-BackupRetentionPlan -Directory $root -Now $Now -Days $Days -MonthlyMonths $MonthlyMonths)
    foreach ($entry in $plan | Where-Object Action -eq 'Remove') {
        if (-not (Test-Path -LiteralPath $entry.FullName -PathType Leaf)) { continue }
        if ((Get-Item -LiteralPath $root).LinkType) { throw 'Diretório de retenção foi substituído por link.' }
        $file = Get-Item -LiteralPath $entry.FullName
        if ($file.LinkType -or [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($file.FullName)) -ne $root) { throw 'Arquivo de retenção fora do escopo.' }
        if ($file.Length -ne $entry.Length -or $file.LastWriteTimeUtc.Ticks -ne $entry.LastWriteTicks) { continue }
        # Recalcular evita remover o mais recente ou um mensal se a pasta mudou durante a limpeza.
        $current = @(Get-BackupRetentionPlan -Directory $root -Now $Now -Days $Days -MonthlyMonths $MonthlyMonths | Where-Object FullName -eq $entry.FullName)
        if ($current.Count -ne 1 -or $current[0].Action -ne 'Remove') { continue }
        if ($PSCmdlet.ShouldProcess($file.FullName,'Remover backup fora da retenção diária e mensal')) { Remove-Item -LiteralPath $file.FullName -Force }
    }
}

function Write-BackupEvent {
    param([string]$LogPath, [string]$Result, [string]$FileName, [DateTimeOffset]$Now = (Get-ClinicNow))
    if ($FileName -and [IO.Path]::GetFileName($FileName) -ne $FileName) { throw 'O log aceita somente o nome do arquivo.' }
    if ($Result -notin @('success','backup_failed','copy_failed','retention_failed','skipped_current','skipped_running')) { throw 'Resultado de log inválido.' }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($LogPath)) | Out-Null
    @{ timestamp = $Now.ToString('o'); result = $Result; file = $FileName } | ConvertTo-Json -Compress | Add-Content -LiteralPath $LogPath -Encoding utf8
}

function Test-ScheduledBackupDue {
    param([string]$LogPath, [DateTimeOffset]$Now = (Get-ClinicNow))
    $due = [DateTimeOffset]::new($Now.Year,$Now.Month,$Now.Day,3,0,0,$Now.Offset)
    if ($Now -lt $due) { $due = $due.AddDays(-1) }
    if (-not (Test-Path -LiteralPath $LogPath)) { return $true }
    # Leitura completa fecha o arquivo antes de retornar: ReadLines pode manter
    # o enumerador aberto ao encontrar sucesso e bloquear a gravação seguinte.
    foreach ($line in [IO.File]::ReadAllLines($LogPath)) {
        try {
            $entry = $line | ConvertFrom-Json
            # PowerShell 7.5+ converte ISO para DateTime; não reinterpretar pela cultura local.
            $timestamp = if ($entry.timestamp -is [datetime]) { [DateTimeOffset]$entry.timestamp } else { [DateTimeOffset]::Parse($entry.timestamp,[Globalization.CultureInfo]::InvariantCulture) }
            if ($entry.result -eq 'success' -and $timestamp -ge $due) { return $false }
        } catch { continue }
    }
    $true
}

function New-BackupTaskXml {
    param([string]$PowerShellPath,[string]$ScriptPath,[string]$ConfigPath,[string]$WorkingDirectory,[string]$UserSid,[datetime]$StartDate = (Get-Date).Date)
    $escape = { param($value) [Security.SecurityElement]::Escape([string]$value) }
    $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $ScriptPath + '" -ConfigPath "' + $ConfigPath + '" -Scheduled'
    @"
<?xml version="1.0"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
 <RegistrationInfo><Description>Backup lógico criptografado da OPTOCOM Visão, diário às 03:00.</Description></RegistrationInfo>
 <Triggers><CalendarTrigger><StartBoundary>$($StartDate.ToString('yyyy-MM-dd'))T03:00:00</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger><LogonTrigger><Enabled>true</Enabled><UserId>$(& $escape $UserSid)</UserId></LogonTrigger></Triggers>
 <Principals><Principal id="Author"><UserId>$(& $escape $UserSid)</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
 <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable><Enabled>true</Enabled><ExecutionTimeLimit>PT2H</ExecutionTimeLimit><RestartOnFailure><Interval>PT15M</Interval><Count>3</Count></RestartOnFailure></Settings>
 <Actions Context="Author"><Exec><Command>$(& $escape $PowerShellPath)</Command><Arguments>$(& $escape $arguments)</Arguments><WorkingDirectory>$(& $escape $WorkingDirectory)</WorkingDirectory></Exec></Actions>
</Task>
"@
}

Export-ModuleMember -Function *-*
