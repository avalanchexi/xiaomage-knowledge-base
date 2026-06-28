# One-shot: convert a text file to UTF-8 (with BOM) if it is not already valid UTF-8.
# Usage: .\eval\fix-encoding.ps1 -Path <file>
# ASCII comments; idempotent.
param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
if(-not (Test-Path -LiteralPath $Path)){ throw "not found: $Path" }
$resolvedPath = (Resolve-Path -LiteralPath $Path).ProviderPath
$bytes = [IO.File]::ReadAllBytes($resolvedPath)
$utf8strict = New-Object System.Text.UTF8Encoding($false, $true)
$isUtf8 = $true
try { [void]$utf8strict.GetString($bytes) } catch { $isUtf8 = $false }
if($isUtf8){ "already UTF-8, unchanged: $Path"; return }
$gb = [System.Text.Encoding]::GetEncoding(54936)
$utf8bom = New-Object System.Text.UTF8Encoding($true)
[IO.File]::WriteAllText($resolvedPath, $gb.GetString($bytes), $utf8bom)
"converted GBK -> UTF-8(BOM): $Path"
