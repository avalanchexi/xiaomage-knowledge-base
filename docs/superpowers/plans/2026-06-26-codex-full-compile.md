# 全量编译 → 建图 实现计划（Codex 执行 · 止于建图）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ~435 篇马永谙文稿编译成互链 wiki 并用 gbrain 建图（止于建图，不做 embedding/think）。

**Architecture:** 三层（`raw/` 只读源 → `wiki/` 编译产物 → `CLAUDE.md` schema）。两阶段：Codex 抽实体 → Claude 冻结 `aliases.md` → Codex 写页 → Claude 建图。驱动器为 Windows-native PowerShell（`compile-batch.ps1`）调 `codex exec` headless、断点续跑。

**Tech Stack:** Codex CLI 0.142.0（`codex exec`，prompt 走 stdin）、gbrain 0.42.44.0（源码 + `bun install` + `bun link`，项目内部署）、PGLite、PowerShell 5.1、git（仅 `小马哥知识库/` 是仓库）。

**分工：** Claude = 部署 / 语料 / schema / 驱动器 / 冻 `aliases.md` / 建图 / 验证；Codex = 抽实体（Task 5）/ 写页（Task 7）。

**关键路径常量：**
- 项目根：`D:\cursor\小马哥时政历史`
- 知识库（git 仓库）：`D:\cursor\小马哥时政历史\小马哥知识库`（下称 `<KB>`）
- gbrain 源码：`D:\cursor\小马哥时政历史\gbrain-src\`（非 git，项目内）
- brain 库：`D:\cursor\小马哥时政历史\brain\`（非 git，项目内）
- 提交对象：所有 `git` 命令用 `git -C "<KB>" …`（项目根非 git 仓库）

**Spec：** [docs/superpowers/specs/2026-06-26-codex-full-compile-execution-design.md](../specs/2026-06-26-codex-full-compile-execution-design.md)

---

## Task 0: 部署 gbrain 0.42.44.0 到项目内（Claude）

**Files:**
- Create: `D:\cursor\小马哥时政历史\gbrain-src\` （解压 + `node_modules`）
- 不改 git 仓库（无提交）

- [ ] **Step 1: 下载 pinned 源码 ZIP**

Run:
```powershell
Invoke-WebRequest "https://codeload.github.com/garrytan/gbrain/zip/090bb53203557f5659563ea28c1c847c32167aeb" -OutFile "$env:TEMP\gbrain-0.42.44.0.zip"
```
Expected: `$env:TEMP\gbrain-0.42.44.0.zip` 存在（数 MB）。失败（网络）→ 记录、换 codeload 节点或改 `zip/refs/heads/master` 重试。

- [ ] **Step 2: 解压到项目内**

Run:
```powershell
Expand-Archive "$env:TEMP\gbrain-0.42.44.0.zip" -DestinationPath "D:\cursor\小马哥时政历史\gbrain-src\" -Force
Get-ChildItem "D:\cursor\小马哥时政历史\gbrain-src\"
```
Expected: 出现目录 `gbrain-090bb53203557f5659563ea28c1c847c32167aeb\`。

- [ ] **Step 3: 本地安装依赖（bun install）**

Run:
```powershell
Set-Location "D:\cursor\小马哥时政历史\gbrain-src\gbrain-090bb53203557f5659563ea28c1c847c32167aeb"
bun install
```
Expected: 装完约 276 个包（含 PGLite WASM、pgvector），`node_modules\` 出现，postinstall 无报错。

- [ ] **Step 4: 链接到全局 PATH（bun link）**

Run:
```powershell
bun link
```
Expected: 注册全局 `gbrain` 命令（落 `~/.bun/bin`），覆盖旧 0.41.29.0 软链。

- [ ] **Step 5: 验证装到的是真 GBrain 0.42.x**

Run:
```powershell
Set-Location "D:\cursor\小马哥时政历史"
gbrain --version
```
Expected: `gbrain 0.42.44.0`（或 0.42.x）。
- 若显示 `1.3.1` → 装成了 npm 抢注的 GPU 库，回 Step 1 重来。
- 若仍显示 `0.41.29.0` → 旧 `gbrain.exe` 被 PATH 优先命中；确认 `~/.bun/bin` 新链接生效（必要时移除旧 `~/.bun/bin/gbrain.exe`），重测。

---

## Task 1: 语料规范化进 raw/ + 空壳检测（Claude）

**Files:**
- Create: `<KB>\normalize-corpus.ps1`
- Create: `<KB>\raw\NNN.md` （约 435 篇）
- Create: `<KB>\.shells.txt` （空壳编号清单，临时）
- Modify: `<KB>\wiki\index.md` （缺正文清单）

- [ ] **Step 1: 写规范化脚本**

Create `D:\cursor\小马哥时政历史\小马哥知识库\normalize-corpus.ps1`:
```powershell
# 把项目根的编号文稿规范化进 raw/，并检测空壳（正文有效中文字数 < 阈值）
$ErrorActionPreference = 'Stop'
$ROOT = 'D:\cursor\小马哥时政历史'
$RAW  = Join-Path $ROOT '小马哥知识库\raw'
$THRESHOLD = 300
New-Item -ItemType Directory -Force -Path $RAW | Out-Null

$shells = @(); $copied = 0
Get-ChildItem "$ROOT\*.md" | ForEach-Object {
  $m = [regex]::Match($_.BaseName, '^(\d+)\.')
  if (-not $m.Success) { return }   # 跳过无前导编号（设计文档等）
  $num = $m.Groups[1].Value
  $raw = Get-Content -Raw -Encoding UTF8 $_.FullName
  $body = ($raw -split "`n" | Where-Object {
    $_ -notmatch '^\s*#' -and $_ -notmatch '录制时间|发布时间' -and $_ -match '\S'
  }) -join ''
  $cjk = ([regex]::Matches($body, '[一-鿿]')).Count
  if ($cjk -lt $THRESHOLD) { $shells += $num }
  else { Copy-Item $_.FullName (Join-Path $RAW "$num.md") -Force; $copied++ }
}
"copied=$copied  shells=$($shells.Count)"
($shells | Sort-Object {[int]$_}) -join "`n" | Out-File (Join-Path $ROOT '小马哥知识库\.shells.txt') -Encoding utf8
"空壳编号: $(($shells | Sort-Object {[int]$_}) -join ', ')"
```

- [ ] **Step 2: 运行并核对计数**

Run:
```powershell
Set-Location "D:\cursor\小马哥时政历史\小马哥知识库"
.\normalize-corpus.ps1
(Get-ChildItem "raw\*.md").Count
```
Expected: `copied` ≈ 435，`shells` ≈ 47，`raw\` 计数 ≈ 435。
- 偏差过大（shells <30 或 >65）→ 打开几篇被判空壳/非空壳的文稿人工核对，微调 `$THRESHOLD` 重跑（清空 `raw\` 后重跑：`Remove-Item raw\*.md`）。

- [ ] **Step 3: 把空壳清单写进 index.md 缺正文清单**

读 `<KB>\.shells.txt`，把 `wiki\index.md` 末尾「缺正文清单」段替换为真实编号列表。
当前内容：
```
## 缺正文清单
（pilot 仅 3 篇，无空壳）
```
改为（把 `.shells.txt` 的真实编号逐行读出、逗号拼接，填到第二行）：
```
## 缺正文清单（空壳·无正文，未编译）
<在此粘贴 .shells.txt 的全部编号，逗号分隔，约 47 个>
```
取值命令：`(Get-Content .shells.txt) -join ', '`

- [ ] **Step 4: 提交**

```powershell
git -C "D:\cursor\小马哥时政历史\小马哥知识库" add normalize-corpus.ps1 raw wiki/index.md
git -C "D:\cursor\小马哥时政历史\小马哥知识库" commit -m "chore: normalize ~435 articles into raw/, mark ~47 shells

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 折叠 pilot learnings + .gitignore（Claude）

**Files:**
- Modify: `<KB>\CLAUDE.md`（frontmatter 加 `created`）
- Modify: `<KB>\AGENTS.md`（同步）
- Create: `<KB>\.gitignore`

- [ ] **Step 1: 给 CLAUDE.md frontmatter 加 `created`**

在 `<KB>\CLAUDE.md` 把这一行：
```
每页 frontmatter 必带：`title` / `type` / `sources`(原文编号数组) / `updated`。
```
改为：
```
每页 frontmatter 必带：`title` / `type` / `sources`(原文编号数组) / `created`(编译日期) / `updated`。
```

- [ ] **Step 2: 同步改 AGENTS.md**

在 `<KB>\AGENTS.md` 做与 Step 1 完全相同的替换（两份 schema 必须一致）。

- [ ] **Step 3: 写 .gitignore（排除驱动器临时产物）**

Create `D:\cursor\小马哥时政历史\小马哥知识库\.gitignore`:
```
.done/
.compile-log
.shells.txt
wiki/.aliases-candidates/
```

- [ ] **Step 4: 验证两份 schema 一致**

Run:
```powershell
$c = (Get-Content -Raw "D:\cursor\小马哥时政历史\小马哥知识库\CLAUDE.md") -replace '(?s)^.*?# 小马哥','# 小马哥'
$a = (Get-Content -Raw "D:\cursor\小马哥时政历史\小马哥知识库\AGENTS.md") -replace '(?s)^.*?# 小马哥','# 小马哥'
if ($c -eq $a) { "SCHEMA MATCH" } else { "MISMATCH — 手动对齐" }
```
Expected: `SCHEMA MATCH`（两文件去掉各自顶部注释后正文一致）。

- [ ] **Step 5: 提交**

```powershell
git -C "D:\cursor\小马哥时政历史\小马哥知识库" add CLAUDE.md AGENTS.md .gitignore
git -C "D:\cursor\小马哥时政历史\小马哥知识库" commit -m "feat: add created frontmatter field; ignore driver artifacts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 写 compile-batch.ps1 驱动器（Claude）

**Files:**
- Create: `<KB>\compile-batch.ps1`

驱动器是 Codex 两次调用（Task 5 抽实体、Task 7 写页）的统一入口。prompt 经 **stdin**（`codex exec -`）投喂，规避 Windows 命令行长度上限。

- [ ] **Step 1: 写驱动脚本**

Create `D:\cursor\小马哥时政历史\小马哥知识库\compile-batch.ps1`:
```powershell
# Windows-native headless 驱动：分批喂 Codex，断点续跑。
# 用法: .\compile-batch.ps1 -Phase entities|pages [-Batch 12]
[CmdletBinding()]
param(
  [ValidateSet('entities','pages')][string]$Phase = 'pages',
  [int]$Batch = 12
)
$ErrorActionPreference = 'Stop'
$KB     = Split-Path -Parent $MyInvocation.MyCommand.Path
$RAW    = Join-Path $KB 'raw'
$WIKI   = Join-Path $KB 'wiki'
$SCHEMA = Join-Path $KB 'CLAUDE.md'
$ALIASES= Join-Path $WIKI 'aliases.md'
$CAND   = Join-Path $WIKI '.aliases-candidates'
$DONE   = Join-Path $KB '.done'
$LOG    = Join-Path $KB '.compile-log'
New-Item -ItemType Directory -Force -Path $DONE | Out-Null
if ($Phase -eq 'entities') { New-Item -ItemType Directory -Force -Path $CAND | Out-Null }

$files = Get-ChildItem "$RAW\*.md" | Sort-Object { [int]([regex]::Match($_.BaseName,'^\d+').Value) }
$total = $files.Count
$md5 = [System.Security.Cryptography.MD5]::Create()
"=== $Phase | $total files | batch=$Batch | agent=codex | $(Get-Date -Format s) ===" | Tee-Object -FilePath $LOG -Append

$schemaText = Get-Content -Raw -Encoding UTF8 $SCHEMA

for ($i = 0; $i -lt $total; $i += $Batch) {
  $end   = [Math]::Min($i + $Batch - 1, $total - 1)
  $batch = $files[$i..$end]
  $key   = ([BitConverter]::ToString($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes(($batch.Name -join "`n")))) -replace '-').Substring(0,8).ToLower()
  $stamp = Join-Path $DONE "$Phase-$key"
  if (Test-Path $stamp) { "skip $Phase/$key (done)"; continue }
  "[$Phase] batch $key ($($batch.Count) files)" | Tee-Object -FilePath $LOG -Append

  $src = ($batch | ForEach-Object { "=== $($_.Name) ===`n" + (Get-Content -Raw -Encoding UTF8 $_.FullName) }) -join "`n`n"

  if ($Phase -eq 'entities') {
    $task = @"
任务（Phase 0 抽实体）：只读以下文稿，按 CLAUDE.md 的实体定义只列 person/org/country 三类。
输出格式每行：候选slug | type | 别名/全称（逗号分隔）。
把本批所有候选用 UTF-8 覆盖写入文件 wiki/.aliases-candidates/batch-$key.txt。
铁律：不写任何 wiki 页；不读、不改 wiki/aliases.md；raw/ 只读；只做机械列举，不跨批去重、不定 slug 终值。
"@
    $aliasesBlock = ""
  } else {
    $task = @"
任务（Phase 1 写页）：按 CLAUDE.md 把以下文稿编译为 wiki 页（主体/事件/观点/source）。
铁律：raw/ 只读绝不改；只写 wiki/ 下对应目录；写 [[链接]] 只查冻结的 wiki/aliases.md 用规范 slug，绝不修改 aliases.md；漏的实体记 wiki/log.md 待补；每篇生成对应 source 页。
要求：6 类页 frontmatter 齐全（title/type/sources/created/updated + 各类型额外字段）；噪声过滤（丢开场寒暄/结尾导流/口语重复）；take 必带 by: 马永谙 + derived_from；消歧规则（take vs fact / 何时建实体页 / event 粒度）照 CLAUDE.md 正反例。
"@
    $aliasesText = if (Test-Path $ALIASES) { Get-Content -Raw -Encoding UTF8 $ALIASES } else { '(空)' }
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
    $prompt | codex exec - -C $KB --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox *>> $LOG
    if ($LASTEXITCODE -ne 0) { $ok = $false }
  } catch { $ok = $false; $_.Exception.Message | Tee-Object -FilePath $LOG -Append }

  if ($ok) { New-Item -ItemType File -Force -Path $stamp | Out-Null }
  else { "FAIL $Phase/$key — 见 $LOG，重跑自动续" | Tee-Object -FilePath $LOG -Append }
}
"[$Phase] 全部批次处理完毕。日志：$LOG" | Tee-Object -FilePath $LOG -Append
```

- [ ] **Step 2: 语法自检（不实跑 Codex）**

Run:
```powershell
$null = [System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw "D:\cursor\小马哥时政历史\小马哥知识库\compile-batch.ps1"), [ref]$null)
"PARSE OK"
```
Expected: `PARSE OK`（无解析错误）。

- [ ] **Step 3: 提交**

```powershell
git -C "D:\cursor\小马哥时政历史\小马哥知识库" add compile-batch.ps1
git -C "D:\cursor\小马哥时政历史\小马哥知识库" commit -m "feat: PowerShell headless driver (codex exec via stdin, resumable)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 工具链冒烟（单篇 · Claude 触发 / Codex 执行一次）

**Files:**
- 临时产出：`<KB>\wiki\.aliases-candidates\batch-*.txt`（1 个）

目的：在全量前确认 `codex exec` 能 headless 跑通（读 schema、写文件、`raw/` 未改、退出码 0）。用 entities 阶段、仅 1 篇（依赖最少）。

- [ ] **Step 1: 准备单篇冒烟目录**

Run:
```powershell
Set-Location "D:\cursor\小马哥时政历史\小马哥知识库"
New-Item -ItemType Directory -Force smoke\raw | Out-Null
Copy-Item raw\137.md smoke\raw\137.md -Force
$before = (Get-FileHash raw\137.md).Hash
```

- [ ] **Step 2: 对单篇直接跑 codex exec（entities）**

Run:
```powershell
$schema = Get-Content -Raw -Encoding UTF8 CLAUDE.md
$src = "=== 137.md ===`n" + (Get-Content -Raw -Encoding UTF8 raw\137.md)
$prompt = @"
遵守规则层：
$schema

任务：只读以下文稿，只列 person/org/country 三类，每行『候选slug | type | 别名』，写入 wiki/.aliases-candidates/smoke-137.txt（UTF-8 覆盖）。不写 wiki 页、不改 aliases.md、raw/ 只读。

文稿：
$src
"@
New-Item -ItemType Directory -Force wiki\.aliases-candidates | Out-Null
$prompt | codex exec - -C "D:\cursor\小马哥时政历史\小马哥知识库" --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox
"EXIT=$LASTEXITCODE"
```
Expected: `EXIT=0`。

- [ ] **Step 3: 验证产出 + raw 未改**

Run:
```powershell
Test-Path wiki\.aliases-candidates\smoke-137.txt
Get-Content wiki\.aliases-candidates\smoke-137.txt | Select-Object -First 10
$after = (Get-FileHash raw\137.md).Hash
if ($before -eq $after) { "RAW UNCHANGED" } else { "RAW MODIFIED — 违反铁律，排查" }
```
Expected: 候选文件存在且含 `united-states | country | …` 等行；`RAW UNCHANGED`。
- 若 `EXIT` 非 0 或文件未生成 → 排查 codex 登录/网络/stdin 行为，**不进 Task 5**。

- [ ] **Step 4: 清理冒烟产物（不提交）**

Run:
```powershell
Remove-Item -Recurse -Force smoke, wiki\.aliases-candidates\smoke-137.txt -ErrorAction SilentlyContinue
```

---

## Task 5: Phase 0 全量抽实体（Codex via 驱动器）

**Files:**
- Create: `<KB>\wiki\.aliases-candidates\batch-*.txt`（约 36 个，每批一个）

- [ ] **Step 1: 跑 entities 全量**

Run（耗时较长，可后台跑）:
```powershell
Set-Location "D:\cursor\小马哥时政历史\小马哥知识库"
.\compile-batch.ps1 -Phase entities -Batch 12
```
Expected: 日志逐批 `[entities] batch <key>`；结束打印「全部批次处理完毕」。

- [ ] **Step 2: 验证候选覆盖**

Run:
```powershell
(Get-ChildItem wiki\.aliases-candidates\batch-*.txt).Count
Get-Content wiki\.aliases-candidates\batch-*.txt | Measure-Object -Line
Select-String -Path wiki\.aliases-candidates\batch-*.txt -Pattern 'wang-anshi|united-states|federal-reserve' | Select-Object -First 5
```
Expected: 候选文件数 ≈ ceil(435/12) ≈ 36；总行数可观；样本实体（王安石/美国/美联储）出现。
- 有 `FAIL` 批 → 直接重跑 `.\compile-batch.ps1 -Phase entities`（`.done` 跳过已成功、只补失败批）。

---

## Task 6: 严谨归并并冻结 aliases.md（Claude · 命门）

**Files:**
- Modify: `<KB>\wiki\aliases.md`（冻结全量词典）
- Modify: `<KB>\wiki\log.md`（冻结记录 + 疑难留痕）

- [ ] **Step 1: 汇总全部候选**

Run:
```powershell
Set-Location "D:\cursor\小马哥时政历史\小马哥知识库"
Get-Content wiki\.aliases-candidates\batch-*.txt -Encoding UTF8 | Sort-Object -Unique | Out-File "$env:TEMP\aliases-raw.txt" -Encoding utf8
(Get-Content "$env:TEMP\aliases-raw.txt").Count
```
Expected: 去重行的原始候选清单（含跨批重复实体、待裁决）。

- [ ] **Step 2: 人工严谨归并（Claude 读 `$env:TEMP\aliases-raw.txt`，按 spec §4b 规则裁决）**

逐条裁决，产出冻结 `aliases.md`，规则（来自 spec §4b）：
- 归并：同一实体所有别名/全称收一行（如 `countries/united-states | country | 美国, 美利坚, 美方, 美`）。
- 去重：同实体绝不出现两个规范 slug（防 `王安石/安石`、`美联储/Fed` 分裂）。
- slug 规范化：中文走拼音连字符 + 目录前缀（`people/` `orgs/` `countries/`）。
- 冲突裁决：同名异指 / 异名同指逐条判定，疑难写 `wiki/log.md`。
- 并入 pilot：现有 6 人 / 8 国 / 3 组织 slug 保持不变。

`aliases.md` 文件头（保留格式）：
```
# 规范名词典 aliases.md（Phase 0 冻结 · 全量 ~435 篇）
# 格式: <规范 slug> | <type> | <别名 / 全称，逗号分隔>
# 冻结时间: 2026-06-26 — Phase 1 写页期间只读不改；漏的实体记 log.md 待补。
```

- [ ] **Step 3: 冻结前自检**

Run:
```powershell
$lines = Get-Content "D:\cursor\小马哥时政历史\小马哥知识库\wiki\aliases.md" | Where-Object { $_ -match '\|' -and $_ -notmatch '^\s*#' }
$slugs = $lines | ForEach-Object { ($_ -split '\|')[0].Trim() }
$dups  = $slugs | Group-Object | Where-Object Count -gt 1
"行数=$($lines.Count)  人=$(($slugs|?{$_ -like 'people/*'}).Count)  国=$(($slugs|?{$_ -like 'countries/*'}).Count)  组织=$(($slugs|?{$_ -like 'orgs/*'}).Count)"
if ($dups) { "重复 slug: $($dups.Name -join ', ') — 必须修" } else { "NO DUP SLUG" }
```
Expected: `NO DUP SLUG`；三类计数合理（远超 pilot 的 6/8/3）。
- 有重复 → 回 Step 2 合并，重跑自检。

- [ ] **Step 4: 记 log + 提交（冻结）**

在 `wiki\log.md` 追加一行：`- 2026-06-26 · Phase 0 全量冻结 aliases.md（<行数> 实体；疑难裁决见下）` + 疑难条目。
```powershell
git -C "D:\cursor\小马哥时政历史\小马哥知识库" add wiki/aliases.md wiki/log.md
git -C "D:\cursor\小马哥时政历史\小马哥知识库" commit -m "feat: freeze full-corpus aliases.md (slug 命门)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Phase 1 全量写页（Codex via 驱动器）

**Files:**
- Modify/Create: `<KB>\wiki\{people,orgs,countries,events,takes,sources}\*.md`（数百页）
- Modify: `<KB>\wiki\log.md`（Codex 追加待补实体）

- [ ] **Step 1: 清空 wiki 6 类目录（全量为权威，避免陈旧合并）**

Run:
```powershell
Set-Location "D:\cursor\小马哥时政历史\小马哥知识库"
'people','orgs','countries','events','takes','sources' | ForEach-Object {
  Remove-Item "wiki\$_\*.md" -Force -ErrorAction SilentlyContinue
}
"cleared; 保留 index.md / log.md / aliases.md"
```

- [ ] **Step 2: 跑 pages 全量**

Run（耗时长，可后台）:
```powershell
.\compile-batch.ps1 -Phase pages -Batch 12
```
Expected: 日志逐批 `[pages] batch <key>`；结束「全部批次处理完毕」。

- [ ] **Step 3: 验证写页产出**

Run:
```powershell
'people','orgs','countries','events','takes','sources' | ForEach-Object {
  "{0,-10} {1}" -f $_, (Get-ChildItem "wiki\$_\*.md" -ErrorAction SilentlyContinue).Count
}
$sample = Get-ChildItem wiki\takes\*.md | Select-Object -First 1
Get-Content $sample.FullName | Select-Object -First 12
```
Expected: 各目录有合理数量页；样本 take 含 frontmatter（`created`/`by: 马永谙`/`derived_from`）+ 正文 `[[链接]]`。
- 有 `FAIL` 批 → 重跑 `.\compile-batch.ps1 -Phase pages`（`.done` 续跑）。

- [ ] **Step 4: 提交**

```powershell
git -C "D:\cursor\小马哥时政历史\小马哥知识库" add wiki
git -C "D:\cursor\小马哥时政历史\小马哥知识库" commit -m "feat: Phase 1 compile ~435 articles into wiki pages

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: 建图（Claude · 严格照笔记本 §4，全程 --no-embedding）

**Files:**
- Create: `D:\cursor\小马哥时政历史\brain\`（PGLite 库，非 git）

- [ ] **Step 1: 建库（--no-embedding，登记为活动库）**

Run:
```powershell
Set-Location "D:\cursor\小马哥时政历史"
gbrain init --pglite --no-embedding --force --path "D:\cursor\小马哥时政历史\brain" --non-interactive
```
Expected: 末行报 `Brain ready` / `Engine: PGLite`；`brain\` 出现 `PG_VERSION`（内容 `17`）。

- [ ] **Step 2: 导入 wiki（排除 aliases.md 等工具文件）**

`aliases.md`/`.aliases-candidates/` 是工具产物非知识页，已在 `.gitignore`；import 前临时移走 `aliases.md` 避免入库：
```powershell
Move-Item "小马哥知识库\wiki\aliases.md" "$env:TEMP\aliases.md.bak" -Force
gbrain import "D:\cursor\小马哥时政历史\小马哥知识库\wiki" --no-embed
Move-Item "$env:TEMP\aliases.md.bak" "小马哥知识库\wiki\aliases.md" -Force
```
Expected: `N pages imported, M chunks created`（N ≈ 数百页，不含 aliases）。

- [ ] **Step 3: 抽边（self-wiring，--source fs）**

Run:
```powershell
gbrain extract links --source fs --dir "D:\cursor\小马哥时政历史\小马哥知识库\wiki"
```
Expected: `Links: created <K> from <P> pages`（K 远超 pilot 的 110）。

---

## Task 9: 验证（Claude）

**Files:** 无写入（只读校验）

- [ ] **Step 1: 规模与断链**

Run:
```powershell
gbrain stats
```
Expected: `Pages` ≈ 数百、`Links` 合理、`Embedded 0`。记录数字。

- [ ] **Step 2: 图谱抽查（节点连边 + 反向可追溯）**

Run:
```powershell
gbrain graph wang-anshi
gbrain backlinks federal-reserve
```
Expected: `wang-anshi` 连到相关 event/take/对立人物；`federal-reserve` 的 backlinks 能追溯到具体 `sources/NNN`。

- [ ] **Step 3: 断链检查**

Run:
```powershell
gbrain lint 2>&1 | Select-Object -First 30
```
Expected: 断链数为 0 或极少（少量记录待 lint 阶段合并，不阻塞本轮）。

- [ ] **Step 4: slug 一致性抽查（无分裂节点）**

Run:
```powershell
Set-Location "D:\cursor\小马哥时政历史\小马哥知识库\wiki"
Get-ChildItem people\*.md | Select-String -Pattern '安石|王安石' | Group-Object Path | Select-Object Name
"应只出现单一 wang-anshi 页，不得有 anshi/wang-anshi 两页"
```
Expected: 同一实体仅一页。

- [ ] **Step 5: take 忠实度 + 可追溯（随机 5 个）**

人工：随机抽 5 个 `wiki\takes\*.md`，逐一核对 `claim` 是否忠于原文、`derived_from` 指向的 `sources/NNN` 能否在 `raw/NNN.md` 找到出处。
Expected: 5/5 忠实且可追溯。
- 不达标 → 定位是 schema（消歧）/词典（slug）/写页（噪声）问题 → 退回 Task 2 / 6 / 7 修正重跑。

- [ ] **Step 6: 记录验证结论**

在 `wiki\log.md` 追加：`- 2026-06-26 · 全量建图完成：stats <pages>/<links>/0 断链；slug 一致；5 take 抽检通过`，提交：
```powershell
git -C "D:\cursor\小马哥时政历史\小马哥知识库" add wiki/log.md
git -C "D:\cursor\小马哥时政历史\小马哥知识库" commit -m "docs: log full-compile graph build + verification results

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 完成定义（Definition of Done）

- `gbrain --version` == 0.42.x（项目内部署）。
- `raw/` ≈ 435 篇；`index.md` 缺正文清单 ≈ 47。
- `aliases.md` 冻结、无重复 slug。
- `wiki/` 6 类目录有页，frontmatter 含 `created`，take 带 `by`+`derived_from`。
- `gbrain stats` 规模合理、0（或极少）断链。
- 随机 5 take 忠实且可 `derived_from` 追回原文。
- 本轮不含 embedding/think/typed 语义边（留作下一轮）。
