# T7 质量闸(cross-model 抽检)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已编译的 435 篇知识库放上"严格档"质量闸——Codex 先做机械+盲抽识别、Claude 后做语义裁决与过线判定——产出可复现、可比较的过线/未过线结论与返工清单。

**Architecture:** 三层检查(完整性/slug 一致/take 忠实度)。**完整性中纯客观的部分用确定性 PowerShell 脚本兜底**(文件存在性、1:1 映射、空壳、断链、frontmatter 字段、findings schema),LLM 只干它擅长的(盲抽语义重抽、忠实度裁决)。两阶段样本:样本A(8 篇)调 prompt,样本B(24 篇)正式验收。Codex 运行复用已验证的 `compile-batch.ps1` 调用模式(node + codex.js,prompt 走 stdin)。

**Tech Stack:** Windows PowerShell 5.1、gbrain 0.42.44.0、Codex CLI(node + `@openai/codex`)、Claude 会话。所有产物落 `小马哥知识库/eval/`,git 跟踪。

---

## 文件结构

| 文件 | 职责 | 状态 |
|---|---|---|
| `小马哥知识库/eval/sample-A.txt` | 调 prompt 样本(8 篇) | 已建 |
| `小马哥知识库/eval/sample-B.txt` | 验收样本(24 篇) | 已建 |
| `小马哥知识库/eval/codex-brief.md` | Codex 识别 pass 简报(含 JSON schema) | 已建 |
| `小马哥知识库/eval/claude-adjudication.md` | Claude 复合裁决简报(含过线口径) | 已建 |
| `小马哥知识库/eval/check-completeness.ps1` | **确定性完整性体检**(只读) | Task 1 建 |
| `小马哥知识库/eval/validate-findings.ps1` | **校验 codex-findings/*.json schema** | Task 2 建 |
| `小马哥知识库/eval/codex-findings/<no>.json` | Codex 产出 | 运行时生成 |
| `小马哥知识库/eval/verdict-A.md` / `verdict-B.md` | Claude 产出:过线判定 + 返工清单 | 运行时生成 |
| `docs/superpowers/specs/2026-06-28-t7-quality-gate-design.md` | 设计 spec | 已建 |

工作目录约定:除特别说明,所有命令在 `小马哥知识库/` 下运行(下称 KB 根)。

---

## Task 1: 确定性完整性体检脚本 + lint 基线

把现场临时跑的机械检查固化成可复跑脚本,并修正 `gbrain lint` 调用(之前 `--path` 只扫了 0 页)。

**Files:**
- Create: `小马哥知识库/eval/check-completeness.ps1`
- Read-only 体检对象:`raw/`、`wiki/`

- [ ] **Step 1: 写体检脚本**

Create `小马哥知识库/eval/check-completeness.ps1`:

```powershell
# T7 完整性层 · 确定性体检(只读)。退出码 = 失败类别数,0 = 全绿。
$ErrorActionPreference = 'Stop'
$kb     = Split-Path -Parent $PSScriptRoot
$raw    = Join-Path $kb 'raw'
$wiki   = Join-Path $kb 'wiki'
$report = Join-Path $PSScriptRoot 'completeness-report.txt'
$lines  = New-Object System.Collections.Generic.List[string]
$fail   = 0
function Log($m){ $lines.Add($m); Write-Output $m }

# [1] raw <-> source 1:1
$rawNos = Get-ChildItem $raw -File -Filter *.md | ForEach-Object { [int]$_.BaseName } | Sort-Object
$srcNos = Get-ChildItem (Join-Path $wiki 'sources') -File -Filter *.md | ForEach-Object { [int]$_.BaseName } | Sort-Object
$missing = @($rawNos | Where-Object { $_ -notin $srcNos })
$orphan  = @($srcNos | Where-Object { $_ -notin $rawNos })
Log ("[1] raw={0} source={1} missing=[{2}] orphan=[{3}]" -f $rawNos.Count,$srcNos.Count,($missing -join ','),($orphan -join ','))
if($missing.Count -or $orphan.Count){ $fail++ }

# [2] 空内容 raw(<120 非空白) / 空壳 wiki 页(正文<60 非空白)
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

# [3] frontmatter 必填 title/type/updated(全类型通用)
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

# [4] [[type/slug]] 链接可解析
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
```

- [ ] **Step 2: 跑脚本拿基线**

Run(KB 根):
```powershell
powershell -ExecutionPolicy Bypass -File .\eval\check-completeness.ps1; "exit=$LASTEXITCODE"
```
Expected: `[1]` 显示 `raw=435 source=435 missing=[] orphan=[]`;`[2]` 显示 `empty_raw=0 stub_pages=0`。`[3]`/`[4]` 给出真实数字。**`[4] broken_links` 是之前没体检过的项——记下这个数。** 若 `[3]/[4]` 非 0,这就是第一批返工信号(进 Task 8 清单)。

- [ ] **Step 3: 修正 gbrain lint 调用(交叉印证 [4])**

Run(KB 根,逐个试到能真正扫页的形式):
```powershell
gbrain lint --dir wiki
```
Expected: 扫描页数 > 0 并报断链/孤儿数(不再是 `0 pages scanned`)。把 lint 的断链数与脚本 `[4]` 对照——两者应同量级。若 `--dir` 不被支持,退而在 wiki 内跑:`Set-Location wiki; gbrain lint; Set-Location ..`。**脚本 `[4]` 为权威**,lint 仅作交叉印证。

- [ ] **Step 4: 提交**

```powershell
git add eval/check-completeness.ps1 eval/completeness-report.txt
git commit -m "feat(eval): deterministic completeness check + lint baseline for T7"
```

---

## Task 2: findings 校验脚本 + 提交已写好的简报/样本

- [ ] **Step 1: 写 findings 校验脚本**

Create `小马哥知识库/eval/validate-findings.ps1`:

```powershell
# 校验某一样本的 codex-findings/*.json 是否齐全且 schema 合规。退出码 0=全通过。
param([ValidateSet('A','B')][string]$Sample = 'A')
$ErrorActionPreference = 'Stop'
$eval = $PSScriptRoot
$nos  = Get-Content (Join-Path $eval "sample-$Sample.txt") |
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
```

- [ ] **Step 2: 建产出目录占位 + 不跟踪运行期日志**

Run(KB 根):
```powershell
New-Item -ItemType Directory -Force -Path .\eval\codex-findings | Out-Null
if(-not (Test-Path .\eval\codex-findings\.gitkeep)){ New-Item -ItemType File -Path .\eval\codex-findings\.gitkeep | Out-Null }
Add-Content -Path .\eval\.gitignore -Encoding UTF8 -Value "completeness-report.txt"
```
Expected: `eval/codex-findings/` 存在,`eval/.gitignore` 含 `completeness-report.txt`(报告是运行产物,不入库)。

- [ ] **Step 3: 提交简报 + 样本 + 校验脚本 + spec**

```powershell
git add eval/sample-A.txt eval/sample-B.txt eval/codex-brief.md eval/claude-adjudication.md eval/validate-findings.ps1 eval/codex-findings/.gitkeep eval/.gitignore
git commit -m "feat(eval): T7 cross-model gate briefs, fixed samples, findings validator"
```
(spec 在外层仓库,另行:`git -C .. add docs/superpowers/specs/2026-06-28-t7-quality-gate-design.md docs/superpowers/plans/2026-06-28-t7-quality-gate.md; git -C .. commit -m "docs: T7 quality-gate spec + plan"`)

---

## Task 3: 样本A — Codex 识别 pass(调 prompt 第一轮)

**Files:** 产出 `小马哥知识库/eval/codex-findings/{137,138,141,123,121,122,135,120}.json`

- [ ] **Step 1: 运行 Codex 识别 pass**

不要修改 `eval/codex-brief.md` 本体。运行时把 `eval/codex-brief.md` 全文与"本轮样本:`eval/sample-A.txt`"拼成 prompt,在 KB 根开一个 Codex 会话执行。交互式最省事:
```powershell
codex   # 在 小马哥知识库/ 下打开,然后粘贴 codex-brief.md 全文 + "本轮样本: eval/sample-A.txt"
```
Headless 复用已验证模式(prompt 走 stdin,等价于 `compile-batch.ps1` 的 `Invoke-CodexExec`):
```powershell
$brief  = Get-Content .\eval\codex-brief.md -Raw -Encoding UTF8
$prompt = $brief + "`n`n本轮样本: eval/sample-A.txt。逐篇读 raw/<no>.md 与其衍生 wiki 页,把每篇结果写入 eval/codex-findings/<no>.json。"
$prompt | codex exec - -C . --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox
```
(若 `codex exec` 直连有编码/路径问题,按 `compile-batch.ps1:27-64` 的 `Resolve-CodexRuntime` 走 `node codex.js`。)
Expected: `eval/codex-findings/` 下出现 8 个 `<no>.json`;Codex **未**写 `verdict.md`、**未**改 `raw/`/`wiki/`/`aliases.md`。

- [ ] **Step 2: 校验 findings schema**

Run:
```powershell
powershell -ExecutionPolicy Bypass -File .\eval\validate-findings.ps1 -Sample A; "exit=$LASTEXITCODE"
```
Expected: `expected=8 missing=[] invalid=[]` 且 `ALL FINDINGS VALID`、`exit=0`。若有 missing/invalid → Codex 漏篇或 schema 跑偏 → 回 Step 1 复跑那几篇(brief 里 schema 是否说清?不清就进 Task 5 改 brief)。

- [ ] **Step 3: 重建累计 `_index.json`**

Run:
```powershell
& .\eval\regen-index.ps1
```
Expected: `index rebuilt: count=32 A=8 B=24` when A+B findings are already present; during an A-only rerun, `count` equals the current number of present findings while both sample manifests are still listed.

- [ ] **Step 4: 确认产物只落 eval/**

Run:
```powershell
git status --short
```
Expected: 改动只在 `eval/codex-findings/`。若 `raw/`/`wiki/`/`aliases.md` 有改动 → Codex 违纪,`git checkout -- raw wiki` 还原并在 brief 里加重纪律。

- [ ] **Step 5: 提交**

```powershell
git add eval/codex-findings/*.json eval/codex-findings/_index.json
git commit -m "eval: codex identify pass on sample-A (round 1)"
```

---

## Task 4: 样本A — Claude 复合裁决(调 prompt 第一轮)

**Files:** 产出 `小马哥知识库/eval/verdict-A.md`

- [ ] **Step 1: 运行 Claude 复合 pass**

在 KB 根开一个 **Claude** 会话,粘贴 `eval/claude-adjudication.md` 全文 + "本轮样本:eval/sample-A.txt"。Claude 读 `raw/` + 衍生 wiki 页 + `codex-findings/<no>.json`,按简报只写入 `eval/verdict-A.md`。

- [ ] **Step 2: 核对 verdict 结构完整**

Run:
```powershell
Select-String -Path .\eval\verdict-A.md -Pattern '判定:|严重:|中级命中率:|slug 一致率:|噪声残留率:|返工清单' | Select-Object -ExpandProperty Line
```
Expected: 6 个锚点都命中——判定行 + 四指标 + 返工清单标题齐全。缺任何一项 → Claude 没按模板,回 Step 1 强调 verdict 模板。

- [ ] **Step 3: 提交**

```powershell
git add eval/verdict-A.md
git commit -m "eval: claude adjudication on sample-A (round 1)"
```

---

## Task 5: prompt 迭代至判定稳定(样本A 收敛门)

样本A 的目的是**把两份简报调到判定稳定可比**,不是过线。

- [ ] **Step 1: 判稳定性**

读 `verdict-A.md`,逐条问:返工清单里的每条问题,是**真缺陷**(知识库确实抽错/漏抽/有噪声)还是**评测假阳性**(简报指令不清导致 Codex/Claude 误判)?

- [ ] **Step 2: 按归因改简报或记返工**
- 假阳性 → 改 `eval/codex-brief.md` 或 `eval/claude-adjudication.md`(把模糊处补成正反例),`git commit -m "fix(eval): clarify <brief> to remove false positive"`,**在同一个样本A 上复跑 Task 3+4**(固定样本才可比),看假阳性是否消失。
- 真缺陷 → 不改简报,记入 Task 8 的总返工清单。

- [ ] **Step 3: 收敛判定**

当连续两轮样本A 的四项指标读数稳定(无新假阳性、指标不再因 prompt 抖动)→ 简报冻结,进样本B。
Run:
```powershell
git add eval/codex-brief.md eval/claude-adjudication.md
git commit -m "chore(eval): freeze T7 briefs after sample-A convergence"
```
Expected: 简报此后不再因评测口径改动(只有 schema 真有歧义才动)。

---

## Task 6: 样本B — Codex 识别 pass(正式验收)

**Files:** 产出 `eval/codex-findings/{1,22,41,72,91,111,131,151,189,216,236,255,274,293,312,331,350,369,388,407,425,444,463,482}.json`

- [ ] **Step 1: 用冻结简报跑样本B**

同 Task 3 Step 1,但样本换成 `eval/sample-B.txt`:
```powershell
$brief  = Get-Content .\eval\codex-brief.md -Raw -Encoding UTF8
$prompt = $brief + "`n`n本轮样本: eval/sample-B.txt。逐篇读 raw/<no>.md 与其衍生 wiki 页,把每篇结果写入 eval/codex-findings/<no>.json。"
$prompt | codex exec - -C . --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox
```
Expected: 24 个 `<no>.json` 生成。

- [ ] **Step 2: 校验**

```powershell
powershell -ExecutionPolicy Bypass -File .\eval\validate-findings.ps1 -Sample B; "exit=$LASTEXITCODE"
```
Expected: `expected=24 missing=[] invalid=[]`、`exit=0`。

- [ ] **Step 3: 重建累计 `_index.json`**

Run:
```powershell
& .\eval\regen-index.ps1
```
Expected: `index rebuilt: count=32 A=8 B=24`.

- [ ] **Step 4: 提交**

```powershell
git add eval/codex-findings/*.json eval/codex-findings/_index.json
git commit -m "eval: codex identify pass on sample-B (acceptance)"
```

---

## Task 7: 样本B — Claude 复合裁决 + 过线判定(权威)

**Files:** 产出 `小马哥知识库/eval/verdict-B.md`

- [ ] **Step 1: 运行 Claude 复合 pass(样本B)**

同 Task 4 Step 1,样本换 `eval/sample-B.txt`,Claude 只写入 `eval/verdict-B.md`。这是**权威验收判定**。

- [ ] **Step 2: 核对四项指标对齐严格档**

Run:
```powershell
Select-String -Path .\eval\verdict-B.md -Pattern '判定:|严重:|中级命中率:|slug 一致率:|噪声残留率:'
```
Expected: 判定行明确"过线/未过线";四指标读数齐全。人工对照严格档:严重=0、中级≤5%、slug≥98%、噪声≤5%。

- [ ] **Step 3: 提交**

```powershell
git add eval/verdict-B.md
git commit -m "eval: claude adjudication on sample-B — acceptance verdict"
```

---

## Task 8: 过线门决策(放行后半程 / 返工回环)

当前状态(2026-06-28):`eval/verdict-B.md` 已判定严格档过线,放行 `ENABLE_SECOND_HALF`。非 gating backlog 只保留 3 个中级 take 补抽:444 两条政策主张 take,91 一条东欧预测 take。

- [ ] **Step 1: 读 verdict-B.md 判定**

- [ ] **Step 2A: 若过线**

在 spec 末尾追加验收结论并解锁后半程标记:
```powershell
Add-Content -Path ..\docs\superpowers\specs\2026-06-28-t7-quality-gate-design.md -Encoding UTF8 -Value "`n## 验收结论(T7)`n- $(Get-Date -Format yyyy-MM-dd) · 样本B 过线 · 详见 eval/verdict-B.md · 放行 ENABLE_SECOND_HALF"
git -C .. add docs/superpowers/specs/2026-06-28-t7-quality-gate-design.md
git -C .. commit -m "docs: T7 acceptance passed — unblock second half"
```
Expected: 记录在案,可进入设计文档 §T9(embedding 重建 + `gbrain think`,注意 DashScope 国内端点 + `embedding_disabled` 残留两坑)。

- [ ] **Step 2B: 若未过线**

把 `verdict-B.md` 返工清单 + Task 5 记下的真缺陷合并,按严重度逐条修:
- 幻觉/张冠李戴 → 改对应 `wiki/**` 页 claim 或 `derived_from`。
- 漏抽 → 对该 `<no>` 重跑 Phase 1 写页(`compile-batch.ps1` 的逻辑)补页。
- slug 不一致 → 在 lint 阶段合并近义 slug。
修完**重新 `gbrain import wiki/` + `extract links`**(brain ⊥ source 不自动同步),再回 Task 6 在样本B 上复跑验收。
```powershell
git add -A
git commit -m "fix(wiki): rework per T7 verdict-B findings"
```

---

## 可选 Task: eval-run.ps1 批量驱动(若嫌手动起会话烦)

若想把 Task 3/6 自动化:照 `compile-batch.ps1:27-64,132-223` 把 `Resolve-CodexRuntime` + `Invoke-CodexExec` 抄进 `eval/eval-run.ps1`,参数 `-Sample A|B`,prompt = `codex-brief.md` + 样本行,调 `Invoke-CodexExec` 即可。**仅在重复跑多轮时才值得做(YAGNI:先手动跑通样本A 再说)。**

---

## 自查(spec 覆盖)

- 完整性层 → Task 1(脚本)+ lint(Step 3);spec §三层[1] ✓
- slug 一致层 → Codex findings `slug_consistency` + Claude 聚合(Task 4/7);spec §三层[2] ✓
- take 忠实度层 → Claude 复合(Task 4/7);spec §三层[3] ✓
- 双模型顺序 Codex→Claude → Task 3→4、6→7;spec Q1 ✓
- 两阶段样本 → 样本A(Task 3-5)/样本B(Task 6-7);spec Q2 ✓
- 严格档过线 → Task 7 Step 2;spec Q3 ✓
- JSON findings → validate-findings.ps1;spec Q4 ✓
- Claude 复合文档化 → claude-adjudication.md(已建);spec Q5 ✓
- 完整性增项(空内容/断链)→ Task 1;spec 范围 ✓
- 过线后放行后半程 → Task 8 Step 2A;spec §流程 ✓
```
