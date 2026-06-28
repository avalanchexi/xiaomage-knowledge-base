# Ensure every .ps1 under the KB is UTF-8 with BOM (PS 5.1 mis-reads non-BOM UTF-8 as GBK).
# ASCII-only comments by design.
$ErrorActionPreference = 'Stop'
$kb = Split-Path -Parent $PSScriptRoot
$utf8strict = New-Object System.Text.UTF8Encoding($false, $true)
$utf8bom    = New-Object System.Text.UTF8Encoding($true)
$gb         = [System.Text.Encoding]::GetEncoding(54936)   # GB18030
$fixed = New-Object System.Collections.Generic.List[string]
$okc   = 0
foreach($f in (Get-ChildItem $kb -Recurse -Filter *.ps1 -File)){
  $bytes = [IO.File]::ReadAllBytes($f.FullName)
  $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
  $hasNonAscii = $false
  foreach($b in $bytes){ if($b -gt 127){ $hasNonAscii = $true; break } }
  if((-not $hasNonAscii) -or $hasBom){ $okc++; continue }
  $isUtf8 = $true
  try { [void]$utf8strict.GetString($bytes) } catch { $isUtf8 = $false }
  $text = if($isUtf8){ $utf8strict.GetString($bytes) } else { $gb.GetString($bytes) }
  [IO.File]::WriteAllText($f.FullName, $text, $utf8bom)
  $fixed.Add(($f.FullName.Substring($kb.Length)) + $(if($isUtf8){' [utf8+bom]'}else{' [gbk->utf8+bom]'}))
}
"already-ok (ascii or already-bom): $okc"
"fixed: $($fixed.Count)"
$fixed | ForEach-Object { "  $_" }
