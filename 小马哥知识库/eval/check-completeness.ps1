# T7 completeness layer - deterministic, read-only check. Exit code = number of failed categories, 0 = all green.
# ASCII-only comments on purpose: PS 5.1 misparses non-BOM UTF-8 scripts under a GBK codepage.
$ErrorActionPreference = 'Stop'
$kb     = Split-Path -Parent $PSScriptRoot
$raw    = Join-Path $kb 'raw'
$wiki   = Join-Path $kb 'wiki'
$report = Join-Path $PSScriptRoot 'completeness-report.txt'
$lines  = New-Object System.Collections.Generic.List[string]
$fail   = 0
function Log($m){ $lines.Add($m); Write-Output $m }

# [1] raw <-> source 1:1 mapping
$rawNos = Get-ChildItem $raw -File -Filter *.md | ForEach-Object { [int]$_.BaseName } | Sort-Object
$srcNos = Get-ChildItem (Join-Path $wiki 'sources') -File -Filter *.md | ForEach-Object { [int]$_.BaseName } | Sort-Object
$missing = @($rawNos | Where-Object { $_ -notin $srcNos })
$orphan  = @($srcNos | Where-Object { $_ -notin $rawNos })
Log ("[1] raw={0} source={1} missing=[{2}] orphan=[{3}]" -f $rawNos.Count,$srcNos.Count,($missing -join ','),($orphan -join ','))
if($missing.Count -or $orphan.Count){ $fail++ }

# [2] empty raw (<120 non-whitespace) / stub wiki page (body <60 non-whitespace)
$emptyRaw = New-Object System.Collections.Generic.List[string]
foreach($f in (Get-ChildItem $raw -File -Filter *.md)){
  $t = Get-Content $f.FullName -Raw -Encoding UTF8
  if((($t -replace '\s','').Length) -lt 120){ $emptyRaw.Add($f.Name) }
}
$stub = New-Object System.Collections.Generic.List[string]
foreach($f in (Get-ChildItem $wiki -File -Recurse -Filter *.md)){
  $t = Get-Content $f.FullName -Raw -Encoding UTF8
  $body = $t -replace '(?s)^---.*?---',''
  if((($body -replace '\s','').Length) -lt 60){ $stub.Add($f.FullName.Substring($kb.Length)) }
}
Log ("[2] empty_raw={0} stub_pages={1}" -f $emptyRaw.Count,$stub.Count)
if($emptyRaw.Count){ $fail++; Log ("    empty_raw: " + ($emptyRaw -join ',')) }
if($stub.Count){ $fail++; Log ("    stub: " + ($stub -join ';')) }

# [3] required frontmatter title/type/updated (universal across types)
$fmFail = New-Object System.Collections.Generic.List[string]
foreach($f in (Get-ChildItem $wiki -File -Recurse -Filter *.md)){
  if($f.Name -in @('aliases.md','index.md','log.md')){ continue }
  $t = Get-Content $f.FullName -Raw -Encoding UTF8
  if($t -notmatch '(?s)^---(.*?)---'){ $fmFail.Add($f.Name + ':no-frontmatter'); continue }
  $fm = $Matches[1]
  foreach($k in 'title','type','updated'){ if($fm -notmatch "(?m)^\s*$k\s*:"){ $fmFail.Add($f.Name + ":miss-$k") } }
}
Log ("[3] frontmatter_issues={0}" -f $fmFail.Count)
if($fmFail.Count){ $fail++; Log ("    " + (($fmFail | Select-Object -First 30) -join ';')) }

# [4] [[type/slug]] link resolvability
$broken = New-Object System.Collections.Generic.List[string]
foreach($f in (Get-ChildItem $wiki -File -Recurse -Filter *.md)){
  $t = Get-Content $f.FullName -Raw -Encoding UTF8
  foreach($m in [regex]::Matches($t,'\[\[([a-z]+)/([a-z0-9\-]+)\]\]')){
    $target = Join-Path $wiki ($m.Groups[1].Value + '\' + $m.Groups[2].Value + '.md')
    if(-not (Test-Path -LiteralPath $target)){ $broken.Add($f.Name + ' -> ' + $m.Value) }
  }
}
Log ("[4] broken_links={0}" -f $broken.Count)
if($broken.Count){ $fail++; Log ("    " + (($broken | Select-Object -First 40) -join ';')) }

$res = if($fail -eq 0){'PASS'} else {"FAIL($fail categories)"}
Log ("RESULT: $res")
$lines | Set-Content -LiteralPath $report -Encoding UTF8
exit $fail
