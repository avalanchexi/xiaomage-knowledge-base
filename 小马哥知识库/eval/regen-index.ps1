# Rebuild eval/codex-findings/_index.json cumulatively from present findings + sample manifests.
# ASCII comments; UTF-8 reads.
$ErrorActionPreference = 'Stop'
$eval = $PSScriptRoot
$fd   = Join-Path $eval 'codex-findings'
function Read-Sample($name){
  Get-Content (Join-Path $eval $name) -Encoding UTF8 |
    Where-Object { $_ -match '^\s*\d' } |
    ForEach-Object { [int]([regex]::Match($_, '\d+').Value) }
}
$saA = @(Read-Sample 'sample-A.txt')
$saB = @(Read-Sample 'sample-B.txt')
$present = @(Get-ChildItem $fd -Filter *.json | Where-Object { $_.BaseName -match '^\d+$' } | ForEach-Object { [int]$_.BaseName })
$idx = [ordered]@{
  samples        = [ordered]@{ A = @($saA | Sort-Object); B = @($saB | Sort-Object) }
  count          = $present.Count
  files          = @($present | Sort-Object | ForEach-Object { "eval/codex-findings/$_.json" })
  regenerated_at = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK')
}
$json = (($idx | ConvertTo-Json -Depth 5) -join "`n") -replace "`r`n", "`n"
[IO.File]::WriteAllText((Join-Path $fd '_index.json'), $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
"index rebuilt: count=$($idx.count) A=$($saA.Count) B=$($saB.Count)"
