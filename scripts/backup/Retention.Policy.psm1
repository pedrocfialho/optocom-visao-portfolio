#Requires -Version 7.4
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-BackupRetentionPlan {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Directory,
        [DateTimeOffset]$Now = ([TimeZoneInfo]::ConvertTime([DateTimeOffset]::UtcNow,[TimeZoneInfo]::FindSystemTimeZoneById('E. South America Standard Time'))),
        [ValidateRange(1,3650)][int]$Days = 30,
        [ValidateRange(1,120)][int]$MonthlyMonths = 12
    )
    if (-not (Test-Path -LiteralPath $Directory -PathType Container)) { return }
    $root = [IO.Path]::GetFullPath($Directory).TrimEnd('\','/')
    # OneDrive Files On-Demand usa ReparsePoint também em pastas/arquivos comuns.
    # LinkType distingue os links/junctions que não devem ser seguidos.
    if ((Get-Item -LiteralPath $root).LinkType) { throw 'Retenção recusada em diretório de link.' }
    $nowLocal = [TimeZoneInfo]::ConvertTime($Now,[TimeZoneInfo]::FindSystemTimeZoneById('E. South America Standard Time'))
    $dailyCutoff = $nowLocal.AddDays(-$Days)
    # Janela de 12 meses-calendário: mês atual e os 11 anteriores.
    $monthStart = [DateTimeOffset]::new($nowLocal.Year,$nowLocal.Month,1,0,0,0,$nowLocal.Offset)
    $monthlyCutoff = $monthStart.AddMonths(1-$MonthlyMonths)
    $entries = [Collections.Generic.List[object]]::new()
    foreach ($file in Get-ChildItem -LiteralPath $root -File) {
        $match = [regex]::Match($file.Name,'^optocom_backup_(\d{4}-\d{2}-\d{2}_\d{6})_[0-9a-f]{8}\.zip\.p7m$')
        $stamp = [DateTimeOffset]::MinValue
        $valid = $match.Success -and [DateTimeOffset]::TryParseExact(($match.Groups[1].Value+'-03:00'),'yyyy-MM-dd_HHmmsszzz',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None,[ref]$stamp)
        $linked = [bool]$file.LinkType
        $entries.Add([pscustomobject]@{
            Name=$file.Name; FullName=$file.FullName; Timestamp=$stamp; Valid=($valid -and -not $linked)
            Length=$file.Length; LastWriteTicks=$file.LastWriteTimeUtc.Ticks
            Action='Ignore'; Reasons=@('nome_data_ou_link_nao_elegivel'); Monthly=$false
        })
    }
    $validEntries = @($entries | Where-Object Valid | Sort-Object @{Expression='Timestamp';Descending=$true},@{Expression='Name';Descending=$true})
    # Datas futuras ficam protegidas, sem substituir a proteção do último backup não futuro.
    $latest = @($validEntries | Where-Object { $_.Timestamp -le $nowLocal } | Select-Object -First 1)
    $months = @{}
    foreach ($entry in $validEntries) {
        $reasons = [Collections.Generic.List[string]]::new()
        if ($latest.Count -and $entry.FullName -eq $latest[0].FullName) { $reasons.Add('mais_recente') }
        if ($entry.Timestamp -gt $nowLocal) { $reasons.Add('data_futura_preservada') }
        if ($entry.Timestamp -ge $dailyCutoff -and $entry.Timestamp -le $nowLocal) { $reasons.Add('diario_30_dias') }
        $month = $entry.Timestamp.ToString('yyyy-MM',[Globalization.CultureInfo]::InvariantCulture)
        if ($entry.Timestamp -ge $monthlyCutoff -and $entry.Timestamp -le $nowLocal -and -not $months.ContainsKey($month)) {
            $months[$month]=$true
            $entry.Monthly=$true
            $reasons.Add('mensal_12_meses')
        }
        $entry.Action = if ($reasons.Count) { 'Keep' } else { 'Remove' }
        $entry.Reasons = if ($reasons.Count) { @($reasons.ToArray()) } else { @('fora_das_janelas') }
    }
    $entries | Sort-Object Name -Descending
}

Export-ModuleMember -Function Get-BackupRetentionPlan
