# Windows-native headless driver: feed Codex in batches with resumable stamps.
# Usage: .\compile-batch.ps1 -Phase entities|pages [-Batch 12]
[CmdletBinding()]
param(
  [ValidateSet('entities','pages')][string]$Phase = 'pages',
  [ValidateRange(1,100)]
  [int]$Batch = 12
)

$ErrorActionPreference = 'Stop'
$KB      = Split-Path -Parent $MyInvocation.MyCommand.Path
$RAW     = Join-Path $KB 'raw'
$WIKI    = Join-Path $KB 'wiki'
$SCHEMA  = Join-Path $KB 'CLAUDE.md'
$ALIASES = Join-Path $WIKI 'aliases.md'
$CAND    = Join-Path $WIKI '.aliases-candidates'
$SOURCES = Join-Path $WIKI 'sources'
$DONE    = Join-Path $KB '.done'
$LOG     = Join-Path $KB '.compile-log'

function Write-Log {
  param([Parameter(Mandatory=$true)][string]$Message)
  Write-Output $Message
  Add-Content -LiteralPath $LOG -Encoding UTF8 -Value $Message
}

function Resolve-CodexRuntime {
  $command = Get-Command 'codex.cmd' -CommandType Application -ErrorAction SilentlyContinue
  if ($command) {
    $codexCmd = (Resolve-Path -LiteralPath $command.Source).ProviderPath
  } else {
    $fallback = 'C:\npm-global\codex.cmd'
    if (Test-Path -LiteralPath $fallback) {
      $codexCmd = (Resolve-Path -LiteralPath $fallback).ProviderPath
    } else {
      throw 'codex.cmd not found on PATH or at C:\npm-global\codex.cmd'
    }
  }

  $codexDir = Split-Path -Parent $codexCmd
  $codexScript = Join-Path $codexDir 'node_modules\@openai\codex\bin\codex.js'
  if (-not (Test-Path -LiteralPath $codexScript)) {
    throw "codex.js not found at expected npm install path: $codexScript"
  }

  $localNode = Join-Path $codexDir 'node.exe'
  if (Test-Path -LiteralPath $localNode) {
    $nodeCommand = (Resolve-Path -LiteralPath $localNode).ProviderPath
  } else {
    $node = Get-Command 'node.exe' -CommandType Application -ErrorAction SilentlyContinue
    if (-not $node) {
      $node = Get-Command 'node' -CommandType Application -ErrorAction SilentlyContinue
    }
    if (-not $node) {
      throw 'node.exe not found beside codex.cmd or on PATH'
    }
    $nodeCommand = (Resolve-Path -LiteralPath $node.Source).ProviderPath
  }

  return [pscustomobject]@{
    NodeCommand = $nodeCommand
    CodexScript = (Resolve-Path -LiteralPath $codexScript).ProviderPath
  }
}

function Quote-ProcessArgument {
  param([Parameter(Mandatory=$true)][AllowEmptyString()][string]$Value)

  if ($Value.Length -eq 0) {
    return '""'
  }

  if ($Value -notmatch '[\s"]') {
    return $Value
  }

  $quoted = '"'
  $backslashes = 0
  foreach ($char in $Value.ToCharArray()) {
    if ($char -eq '\') {
      $backslashes += 1
    } elseif ($char -eq '"') {
      if ($backslashes -gt 0) {
        $quoted += '\' * (($backslashes * 2) + 1)
        $backslashes = 0
      } else {
        $quoted += '\'
      }
      $quoted += '"'
    } else {
      if ($backslashes -gt 0) {
        $quoted += '\' * $backslashes
        $backslashes = 0
      }
      $quoted += $char
    }
  }

  if ($backslashes -gt 0) {
    $quoted += '\' * ($backslashes * 2)
  }

  $quoted += '"'
  return $quoted
}

function Get-CompletedTaskText {
  param(
    [object]$Task,
    [int]$TimeoutMs = 2000
  )

  if ($null -eq $Task) {
    return ''
  }

  try {
    if (-not $Task.IsCompleted) {
      [void]$Task.Wait($TimeoutMs)
    }

    if ($Task.IsCompleted -and -not $Task.IsFaulted -and -not $Task.IsCanceled) {
      return $Task.Result
    }
  } catch {
    return ''
  }

  return ''
}

function Invoke-CodexExec {
  param(
    [Parameter(Mandatory=$true)][string]$NodeCommand,
    [Parameter(Mandatory=$true)][string]$CodexScript,
    [Parameter(Mandatory=$true)][string]$WorkingDirectory,
    [Parameter(Mandatory=$true)][string]$Prompt,
    [Parameter(Mandatory=$true)][string]$LogPath
  )

  $arguments = @(
    $CodexScript
    'exec'
    '-'
    '-C'
    $WorkingDirectory
    '--skip-git-repo-check'
    '--dangerously-bypass-approvals-and-sandbox'
  )

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $NodeCommand
  $psi.Arguments = ($arguments | ForEach-Object { Quote-ProcessArgument -Value $_ }) -join ' '
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
  $psi.CreateNoWindow = $true

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $psi
  $started = $false
  $stdinClosed = $false
  $stdoutTask = $null
  $stderrTask = $null
  try {
    $started = $process.Start()
    if (-not $started) {
      throw "Failed to start node process: $NodeCommand"
    }

    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()

    $promptBytes = [Text.Encoding]::UTF8.GetBytes($Prompt)
    $process.StandardInput.BaseStream.Write($promptBytes, 0, $promptBytes.Length)
    $process.StandardInput.Close()
    $stdinClosed = $true

    $process.WaitForExit()

    return $process.ExitCode
  } catch {
    if ($started) {
      if (-not $stdinClosed) {
        try {
          $process.StandardInput.Close()
          $stdinClosed = $true
        } catch {}
      }

      try {
        if (-not $process.HasExited) {
          [void]$process.WaitForExit(2000)
        }
      } catch {}

      try {
        if (-not $process.HasExited) {
          $process.Kill()
          [void]$process.WaitForExit(2000)
        }
      } catch {}
    }

    throw
  } finally {
    $stdout = Get-CompletedTaskText -Task $stdoutTask
    $stderr = Get-CompletedTaskText -Task $stderrTask

    if ($stdout.Length -gt 0) {
      [System.IO.File]::AppendAllText($LogPath, $stdout, [Text.Encoding]::UTF8)
    }
    if ($stderr.Length -gt 0) {
      [System.IO.File]::AppendAllText($LogPath, $stderr, [Text.Encoding]::UTF8)
    }

    $process.Dispose()
  }
}

function Get-FileFingerprint {
  param([Parameter(Mandatory=$true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return '<missing>'
  }

  $item = Get-Item -LiteralPath $Path
  if ($item.PSIsContainer) {
    return '<directory>'
  }

  $hash = Get-FileHash -LiteralPath $Path -Algorithm SHA256
  return "$($item.Length)|$($hash.Hash)"
}

function Get-ContentFingerprint {
  param([Parameter(Mandatory=$true)][string]$Path)
  $entries = Get-ChildItem -LiteralPath $Path -Filter '*.md' -File |
    Sort-Object FullName |
    ForEach-Object {
      $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
      "$($_.Name)|$($_.Length)|$($hash.Hash)"
    }
  $payload = $entries -join "`n"
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  return ([BitConverter]::ToString($sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($payload))) -replace '-').ToLowerInvariant()
}

function Test-NonEmptyFile {
  param([Parameter(Mandatory=$true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return $false
  }

  $item = Get-Item -LiteralPath $Path
  return (-not $item.PSIsContainer) -and ($item.Length -gt 0)
}

function Test-BatchOutput {
  param(
    [Parameter(Mandatory=$true)][string]$Phase,
    [Parameter(Mandatory=$true)][string]$Key,
    [Parameter(Mandatory=$true)][object[]]$BatchFiles
  )

  if ($Phase -eq 'entities') {
    $candidatePath = Join-Path $CAND "batch-$Key.txt"
    if (Test-NonEmptyFile -Path $candidatePath) {
      return $true
    }

    Write-Log "FAIL $Phase/$Key - missing or empty aliases candidate: $candidatePath"
    return $false
  }

  $missing = @()
  foreach ($file in $BatchFiles) {
    $sourcePath = Join-Path $SOURCES "$($file.BaseName).md"
    if (-not (Test-NonEmptyFile -Path $sourcePath)) {
      $missing += $sourcePath
    }
  }

  if ($missing.Count -eq 0) {
    return $true
  }

  Write-Log "FAIL $Phase/$Key - missing or empty source pages:"
  foreach ($path in $missing) {
    Write-Log "  $path"
  }
  return $false
}

New-Item -ItemType Directory -Force -Path $DONE | Out-Null
if ($Phase -eq 'entities') {
  New-Item -ItemType Directory -Force -Path $CAND | Out-Null
}

$files = Get-ChildItem -LiteralPath $RAW -Filter '*.md' | Sort-Object { [int]([regex]::Match($_.BaseName, '^\d+').Value) }
$total = $files.Count
$md5 = [System.Security.Cryptography.MD5]::Create()
Write-Log "=== $Phase | $total files | batch=$Batch | agent=codex | $(Get-Date -Format s) ==="

$schemaText = Get-Content -Raw -Encoding UTF8 -LiteralPath $SCHEMA
$codexRuntime = Resolve-CodexRuntime
$hadFailure = $false
$failedBatches = @()

for ($i = 0; $i -lt $total; $i += $Batch) {
  $end = [Math]::Min($i + $Batch - 1, $total - 1)
  $batchFiles = $files[$i..$end]
  $key = ([BitConverter]::ToString($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes(($batchFiles.Name -join "`n")))) -replace '-').Substring(0, 8).ToLower()
  # .done stamps are tied to batch grouping; rerun with the same -Batch for best resume behavior.
  $stamp = Join-Path $DONE "$Phase-$key"
  if (Test-Path -LiteralPath $stamp) {
    "skip $Phase/$key (done)"
    continue
  }

  Write-Log "[$Phase] batch $key ($($batchFiles.Count) files)"

  $rawFingerprintBefore = Get-ContentFingerprint -Path $RAW
  $aliasesFingerprintBefore = Get-FileFingerprint -Path $ALIASES

  $src = ($batchFiles | ForEach-Object {
    "=== $($_.Name) ===`n" + (Get-Content -Raw -Encoding UTF8 -LiteralPath $_.FullName)
  }) -join "`n`n"

  if ($Phase -eq 'entities') {
    $task = @"
任务（Phase 0 抽实体）：只读以下文稿，按 CLAUDE.md 的实体定义只列 person/org/country 三类。
输出格式每行：候选slug | type | 别名/全称（逗号分隔）。
把本批所有候选用 UTF-8 覆盖写入文件 wiki/.aliases-candidates/batch-$key.txt。
铁律：不写任何 wiki 页；不读、不改 wiki/aliases.md；raw/ 只读；只做机械列举，不跨批去重、不定 slug 终值。
"@
    $aliasesBlock = ''
  } else {
    $task = @"
任务（Phase 1 写页）：按 CLAUDE.md 把以下文稿编译为 wiki 页（主体/事件/观点/source）。
铁律：raw/ 只读绝不改；只写 wiki/ 下对应目录；写 [[链接]] 只查冻结的 wiki/aliases.md 用规范 slug，绝不修改 aliases.md；漏的实体记 wiki/log.md 待补；每篇生成对应 source 页。
要求：6 类页 frontmatter 齐全（title/type/sources/created/updated + 各类型额外字段）；噪声过滤（丢开场寒暄/结尾导流/口语重复）；take 必带 by: 马永谙 + derived_from；消歧规则（take vs fact / 何时建实体页 / event 粒度）照 CLAUDE.md 正反例。
"@
    $aliasesText = if (Test-Path -LiteralPath $ALIASES) {
      Get-Content -Raw -Encoding UTF8 -LiteralPath $ALIASES
    } else {
      '(空)'
    }
    $aliasesBlock = "当前冻结词典 aliases.md：`n$aliasesText`n`n"
  }

  $prompt = @"
遵守规则层（编译式 RAG / LLM Wiki 范式）：
$schemaText

$aliasesBlock$task

文稿：
$src
"@

  $ok = $true
  try {
    $codexExitCode = Invoke-CodexExec -NodeCommand $codexRuntime.NodeCommand -CodexScript $codexRuntime.CodexScript -WorkingDirectory $KB -Prompt $prompt -LogPath $LOG
    if ($codexExitCode -ne 0) {
      $ok = $false
      Write-Log "FAIL $Phase/$key - codex exit code $codexExitCode"
    }
  } catch {
    $ok = $false
    Write-Log -Message ($_.Exception.Message)
  }

  $rawFingerprintAfter = Get-ContentFingerprint -Path $RAW
  if ($rawFingerprintAfter -ne $rawFingerprintBefore) {
    $ok = $false
    Write-Log "FAIL $Phase/$key - raw/ changed during batch; not stamping done"
  }

  $aliasesFingerprintAfter = Get-FileFingerprint -Path $ALIASES
  if ($aliasesFingerprintAfter -ne $aliasesFingerprintBefore) {
    $ok = $false
    Write-Log "FAIL $Phase/$key - wiki/aliases.md changed during batch; not stamping done"
  }

  if ($ok -and -not (Test-BatchOutput -Phase $Phase -Key $key -BatchFiles $batchFiles)) {
    $ok = $false
  }

  if ($ok) {
    New-Item -ItemType File -Force -Path $stamp | Out-Null
  } else {
    $hadFailure = $true
    $failedBatches += "$Phase/$key"
    Write-Log "FAIL $Phase/$key - see $LOG; rerun resumes automatically"
  }
}

if ($hadFailure) {
  Write-Log "[$Phase] failed batches: $($failedBatches -join ', '). Log: $LOG"
  exit 1
}

Write-Log "[$Phase] all batches completed successfully. Log: $LOG"
