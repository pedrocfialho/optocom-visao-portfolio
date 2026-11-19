#Requires -Version 7.4
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Retention.Policy.psm1') -Force
$root = Join-Path ([IO.Path]::GetTempPath()) ('optocom-retention-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root) | Out-Null
$script:checks=0
function Assert($condition,[string]$message) { if(-not $condition){throw $message};$script:checks++ }
function Add-Sample([string]$Date,[string]$Suffix='12345678') {
    $name='optocom_backup_'+$Date+'_'+$Suffix+'.zip.p7m'
    [IO.File]::WriteAllText((Join-Path $root $name),'SYNTHETIC LOCAL RETENTION TEST')
    $name
}
try {
    $now=[DateTimeOffset]::Parse('2026-11-04T12:00:00-03:00',[Globalization.CultureInfo]::InvariantCulture)
    $latest=Add-Sample '2026-11-04_030000'
    $sameMonth=Add-Sample '2026-11-01_030000'
    $edge=Add-Sample '2026-10-05_120000'
    $outside=Add-Sample '2026-10-05_115959'
    $octLatest=Add-Sample '2026-10-31_030000'
    $sepOld=Add-Sample '2026-09-10_030000'
    $sepNew=Add-Sample '2026-09-30_030000'
    $firstMonth=Add-Sample '2025-12-01_030000'
    $tooOld=Add-Sample '2025-11-30_235959'
    $future=Add-Sample '2026-12-01_030000'
    $invalid=Add-Sample '2026-02-30_030000'
    [IO.File]::WriteAllText((Join-Path $root 'unrelated.sql'),'test')
    [IO.File]::WriteAllText((Join-Path $root ($latest+'.partial')),'test')
    $before=@(Get-ChildItem -LiteralPath $root -File | ForEach-Object { $_.Name+':'+(Get-FileHash -LiteralPath $_.FullName).Hash })
    $plan=@(Get-BackupRetentionPlan $root $now)
    function Entry($name) { $plan | Where-Object Name -eq $name }
    Assert ((Entry $latest).Action -eq 'Keep' -and (Entry $latest).Monthly) 'Último backup é diário e mensal.'
    Assert ((Entry $sameMonth).Action -eq 'Keep' -and -not (Entry $sameMonth).Monthly) 'Backup diário adicional do mês deve ficar.'
    Assert ((Entry $edge).Action -eq 'Keep') 'Limite exato de 30 dias incluído.'
    Assert ((Entry $outside).Action -eq 'Remove') 'Um segundo antes do limite e sem proteção mensal é elegível.'
    Assert ((Entry $octLatest).Monthly) 'Mensal é o arquivo mais recente do mês.'
    Assert ((Entry $sepOld).Action -eq 'Remove' -and (Entry $sepNew).Action -eq 'Keep') 'Mês antigo preserva somente o mais recente.'
    Assert ((Entry $firstMonth).Monthly -and (Entry $tooOld).Action -eq 'Remove') 'Janela mensal inclui dezembro/2025 até novembro/2026.'
    Assert ((Entry $future).Action -eq 'Keep') 'Datas futuras são preservadas conservadoramente.'
    Assert ((Entry $invalid).Action -eq 'Ignore') 'Data inválida não deve autorizar exclusão.'
    Assert ((Entry 'unrelated.sql').Action -eq 'Ignore' -and (Entry ($latest+'.partial')).Action -eq 'Ignore') 'Arquivos alheios/parciais não são alvos.'
    $after=@(Get-ChildItem -LiteralPath $root -File | ForEach-Object { $_.Name+':'+(Get-FileHash -LiteralPath $_.FullName).Hash })
    Assert (($before -join '|') -eq ($after -join '|')) 'Simulação não altera conteúdo nem exclui arquivos.'
    Assert (@($plan | Where-Object Monthly | Group-Object { $_.Timestamp.ToString('yyyy-MM') } | Where-Object Count -gt 1).Count -eq 0) 'No máximo um mensal por mês.'
    # Empate no segundo: decisão determinística pelo nome; ambos ainda são diários.
    $tie=Add-Sample '2026-11-04_030000' 'ffffffff'
    $plan=@(Get-BackupRetentionPlan $root $now)
    Assert ((Entry $tie).Monthly -and -not (Entry $latest).Monthly) 'Empate de horário usa identificador para seleção determinística.'
    # A proteção do mais recente independe das duas janelas.
    $aged=@(Get-BackupRetentionPlan $root ([DateTimeOffset]::Parse('2030-01-01T12:00:00-03:00')))
    Assert (@($aged | Where-Object Action -eq 'Keep').Count -eq 1 -and ($aged | Where-Object Action -eq 'Keep').Name -eq $future) 'Nunca remover o último backup, mesmo depois de anos sem novas cópias.'
    # Ano bissexto e virada de ano na janela mensal.
    Add-Sample '2024-02-29_030000' | Out-Null
    $leap=@(Get-BackupRetentionPlan $root ([DateTimeOffset]::Parse('2025-01-15T12:00:00-03:00')))
    Assert (($leap | Where-Object Name -like '*2024-02-29*').Monthly) 'Fevereiro bissexto incluído na janela fevereiro/2024 a janeiro/2025.'
    $empty=Join-Path $root 'empty';[IO.Directory]::CreateDirectory($empty)|Out-Null
    Assert (@(Get-BackupRetentionPlan $empty $now).Count -eq 0) 'Pasta vazia aceita.'
    Assert (@(Get-BackupRetentionPlan (Join-Path $root 'missing') $now).Count -eq 0) 'Pasta ausente não provoca exclusão.'
    Import-Module (Join-Path $PSScriptRoot 'Backup.Common.psm1') -Force
    $beforeNames=@(Get-ChildItem -LiteralPath $root -File | Select-Object -ExpandProperty Name | Sort-Object)
    Invoke-BackupRetention $root -Now $now -WhatIf
    Assert (($beforeNames -join '|') -eq ((Get-ChildItem -LiteralPath $root -File | Select-Object -ExpandProperty Name | Sort-Object) -join '|')) 'Executor em WhatIf não altera nem apaga os arquivos sintéticos.'
    $expected=@(Get-BackupRetentionPlan $root $now | Where-Object Action -ne 'Remove' | Select-Object -ExpandProperty Name | Sort-Object)
    Invoke-BackupRetention $root -Now $now
    $remaining=@(Get-ChildItem -LiteralPath $root -File | Select-Object -ExpandProperty Name | Sort-Object)
    Assert (($expected -join '|') -eq ($remaining -join '|')) 'Executor remove somente os arquivos sintéticos elegíveis e preserva diários/mensais/mais recente/ignorados.'
    'PASS: '+$script:checks+' verificações de retenção; nenhuma leitura do banco ou exclusão de backups reais.'
} finally {
    # Exclusão individual somente de arquivos sintéticos na pasta temporária gerada acima.
    $resolved=[IO.Path]::GetFullPath($root)
    if ([IO.Path]::GetFileName($resolved) -notmatch '^optocom-retention-[0-9a-f]{32}$' -or [IO.Path]::GetDirectoryName($resolved).TrimEnd('\','/') -ne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')) {throw 'Limpeza de teste fora do escopo recusada.'}
    foreach($file in Get-ChildItem -LiteralPath $root -File) {Remove-Item -LiteralPath $file.FullName -Force}
    $empty=Join-Path $root 'empty';if(Test-Path -LiteralPath $empty){[IO.Directory]::Delete($empty)}
    [IO.Directory]::Delete($root)
}
