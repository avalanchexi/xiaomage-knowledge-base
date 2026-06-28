# Validate a sample's codex-findings/*.json: present and schema-conformant. Exit 0 = all pass.
# ASCII-only comments on purpose: PS 5.1 misparses non-BOM UTF-8 scripts under a GBK codepage.
param([ValidateSet('A','B')][string]$Sample = 'A')
$ErrorActionPreference = 'Stop'
$eval = $PSScriptRoot
$nos  = Get-Content (Join-Path $eval "sample-$Sample.txt") -Encoding UTF8 |
        Where-Object { $_ -match '^\s*\d' } |
        ForEach-Object { [int]([regex]::Match($_, '\d+').Value) }
$findDir  = Join-Path $eval 'codex-findings'
$required = 'article_no','completeness','blind_extraction','page_vs_blind','slug_consistency','noise_scan','codex_flags'
$miss = New-Object System.Collections.Generic.List[string]
$bad  = New-Object System.Collections.Generic.List[string]
foreach($n in $nos){
  $f = Join-Path $findDir "$n.json"
  if(-not (Test-Path -LiteralPath $f)){ $miss.Add("$n"); continue }
  try { $o = Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json }
  catch { $bad.Add("$n:parse-error"); continue }
  foreach($k in $required){ if(($o.PSObject.Properties.Name -notcontains $k)){ $bad.Add("$n:miss-$k") } }
}
"sample=$Sample expected=$($nos.Count) missing=[$($miss -join ',')] invalid=[$($bad -join ';')]"
if($miss.Count -or $bad.Count){ exit 1 } else { Write-Output 'ALL FINDINGS VALID'; exit 0 }
