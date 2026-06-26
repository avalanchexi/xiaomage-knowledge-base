$ROOT = 'D:\cursor\小马哥时政历史'
$RAW = Join-Path $ROOT '小马哥知识库\raw'
$THRESHOLD = 300
$ErrorActionPreference = 'Stop'

$KB = Join-Path $ROOT '小马哥知识库'
$ShellsPath = Join-Path $KB '.shells.txt'
$Utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false

# If the threshold or numbered source set changes, clear stale raw/*.md before rerunning.
New-Item -ItemType Directory -Path $RAW -Force | Out-Null

$Articles = Get-ChildItem -LiteralPath $ROOT -Filter '*.md' -File | ForEach-Object {
    if ($_.BaseName -match '^(\d+)\.') {
        [pscustomobject]@{
            Number = [int]$Matches[1]
            Path = $_.FullName
        }
    }
} | Sort-Object Number

$Copied = 0
$Shells = New-Object System.Collections.Generic.List[int]

foreach ($Article in $Articles) {
    $Text = [System.IO.File]::ReadAllText($Article.Path, [System.Text.Encoding]::UTF8)
    $BodyLines = foreach ($Line in ($Text -split '\r?\n')) {
        if ($Line -match '^\s*$') { continue }
        if ($Line -match '^\s*#') { continue }
        if ($Line -match '录制时间|发布时间') { continue }
        $Line
    }

    $Body = $BodyLines -join "`n"
    $CjkCount = [regex]::Matches($Body, '[一-鿿]').Count

    if ($CjkCount -lt $THRESHOLD) {
        $Shells.Add($Article.Number)
        continue
    }

    $Destination = Join-Path $RAW ('{0}.md' -f $Article.Number)
    Copy-Item -LiteralPath $Article.Path -Destination $Destination -Force
    $Copied++
}

$ShellNumbers = @($Shells | Sort-Object -Unique)
$ShellText = $ShellNumbers -join ', '
[System.IO.File]::WriteAllText($ShellsPath, $ShellText + [Environment]::NewLine, $Utf8NoBom)

Write-Host ('copied: {0}' -f $Copied)
Write-Host ('shells: {0}' -f $ShellNumbers.Count)
Write-Host ('shell numbers: {0}' -f $ShellText)
