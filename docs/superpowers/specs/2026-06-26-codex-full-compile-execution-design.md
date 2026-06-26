# 执行设计：全量编译 → 建图（Codex 执行 · 止于建图）

- 项目：小马哥时政历史知识库（GBrain 编译式 RAG）
- 阶段：第一轮全量执行（承接已 APPROVED 的 [office-hours + eng-review 设计](../../../.gstack/projects/unknown/tywin-unknown-design-20260626-113054.md)）
- 分工：**Claude 部署 / 冻 `aliases.md` / 建图 / 验证；Codex 抽实体 / 写页**（详见 §2 分工表）
- 日期：2026-06-26
- 状态：待用户复审

---

## 1. 背景（当前真实状态，已核对文件）

- **上游设计已 APPROVED**：`/office-hours`（Builder）+ `/plan-eng-review` 产出完整管线与任务 T1–T10，权威管线为两阶段（Phase 0 冻词典 → Phase 1 写页 → 建图 → 质量闸 → 第二半）。
- **Pilot 已跑通**（金融战簇 137/138/141）：schema `CLAUDE.md`/`AGENTS.md` 已写、`compile-batch.sh` 驱动已写、`aliases.md` 已冻、28 个 wiki 页已建、`gbrain import` 31 页 / `extract links` 110 边 / 0 断链。
- **语料现状**：~483 篇编号文稿在**项目根目录**（含 1 篇非文章的设计文档 md），`小马哥知识库/raw/` 仅有 137/138/141 三篇。
- **环境现状**：本机 `gbrain 0.41.29.0`（bun 装于 `~/.bun/bin`）、`codex-cli 0.142.0`、`bun 1.3.11`、node、git 均在；**无 `claude` CLI**；D:\ 为 NTFS（PGLite 安全）；无 brain 目录（全新构建）；本会话 Bash 工具 fork 失败（Windows 沙箱问题）。
- **Pilot learnings 已记于 `log.md` 但未折叠**：① 各页 frontmatter 应加 `created`（gbrain-base 必填）② `aliases.md` 应排除出 import ③ self-wiring 仅产 `mentions` 边。

## 2. 锁定的决策

| 维度 | 决定 |
|---|---|
| 执行范围 | 全量 ~435 篇编译，**止于建图**（不做 embedding / think） |
| 人工关口 | **全自动一把跑完**，跑完统一抽检 |
| gbrain 版本 | 升级到 0.42.x（v0.42.44.0，commit `090bb53203557f5659563ea28c1c847c32167aeb`） |
| 部署方法 | **严格按两本 ipynb**：源码 + `bun install` + `bun link`，**忽略本机已装的 0.41.29.0** |
| 部署位置 | **gbrain 源码 + node_modules + brain 全部落在当前项目目录下**（不放 `~/dev`、不污染全局） |
| 执行环境 | **原生 Windows + bun**，项目与 brain 均在 D:\ NTFS |
| 方案 | A · 忠实分阶段管线（B 单遍大爆炸 / C Claude 编排逐批 已否决） |

### 分工（用户明确）

| 步骤 | 负责 |
|---|---|
| 0 部署 gbrain（项目内，按 ipynb） | **Claude Code** |
| 1 语料规范化进 `raw/` | **Claude Code** |
| 4a Phase 0 抽实体（全量列 person/org/country） | **Codex**（`codex exec` headless） |
| 4b 归并 / 去重 / 规范 slug / **冻结 `aliases.md`**（命门） | **Claude Code**（严谨维护） |
| 5 Phase 1 解析写页（用冻结词典） | **Codex**（`codex exec` headless，全自动） |
| 6–7 建图 + 验证 | **Claude Code** |

## 3. 范围与边界

**IN（本轮做）：** 部署 gbrain 0.42.44.0 → 语料规范化进 `raw/`（483→~435，标记 47 空壳）→ 折叠 3 条 pilot learnings → Phase 0 全量冻 `aliases.md` → Phase 1 全量写 wiki 页 → 建图（`import --no-embed` + `extract links --source fs`）→ 抽检。

**OUT（本轮明确不做，附理由）：**
- embedding 重建 / `gbrain think` / DashScope / DeepSeek 配置 —— 属第二半，本轮止于建图。
- 质量闸 cross-model（T7）—— 改为跑完人工抽检（用户选「全自动一把跑完、最后抽检」）。
- 富页 pass-2（T8）、增量协议（T10）—— 设计已划为后续/YAGNI。
- typed 语义边（caused/about/opposes 等）—— self-wiring 不认中文动词，见 §10。

## 4. 管线（命令严格照 ipynb §3–4）

```
0. 部署      [Claude] 按笔记本「源码 + bun install + bun link」装 0.42.44.0 到项目内
1. 语料准备   [Claude] 483 根目录 .md → raw/NNN.md；空壳检测 → 排除 + index 标记
2. learnings  [Claude] 折叠：created 字段 / import 排除 aliases / 接受 mentions-only
3. 冒烟       [Claude] 1 篇跑通 codex exec 工具链
4a. Phase 0  [Codex]  PowerShell 驱动循环 → 全量「只列实体」（不写页）
4b. 冻词典    [Claude] 严谨归并/去重/规范 slug → 冻结 aliases.md（命门）
5. Phase 1   [Codex]  PowerShell 驱动循环 → 全量写页（只读冻结词典，全自动）
6. 建图      [Claude] gbrain init --no-embedding → import --no-embed → extract links --source fs
7. 验证      [Claude] gbrain stats / graph / backlinks + 抽查 slug/噪声/take
```

### 阶段 0 · 部署 gbrain 0.42.44.0 到项目内（Claude Code · PowerShell 等价于笔记本 Unix 命令）

笔记本铁律：**只有「源码 + `bun install` + `bun link`」是对的**；`npm install -g gbrain`（装到抢注的 GPU 库 v1.3.1）和 `bun install -g github:garrytan/gbrain`（Bun 沙箱拦 postinstall）都是错的。**用户要求部署到当前项目下**——故源码解压、`bun install`、brain 全部落项目目录，不放 `~/dev`。

Windows 原生等价步骤（项目根 = `D:\cursor\小马哥时政历史`）：
1. `Invoke-WebRequest "https://codeload.github.com/garrytan/gbrain/zip/090bb53203557f5659563ea28c1c847c32167aeb" -OutFile $env:TEMP\gbrain-0.42.44.0.zip`（替代 `curl`）
2. `Expand-Archive $env:TEMP\gbrain-0.42.44.0.zip -DestinationPath D:\cursor\小马哥时政历史\gbrain-src\ -Force`（替代 `unzip`；解压出以完整 commit 命名的目录 `gbrain-090bb53203557f5659563ea28c1c847c32167aeb\`）
3. `cd D:\cursor\小马哥时政历史\gbrain-src\gbrain-090bb53… ; bun install`（postinstall 在本地正常执行，装 PGLite WASM + pgvector，`node_modules` 落项目内）
4. `bun link`（注册全局 `gbrain` 命令，源码仍在项目内；覆盖旧 0.41.29.0 软链）
5. **验证：`gbrain --version` 必须显示 `0.42.x`**（若显示 1.3.1 = 装错，回 1 重来）

- **brain 物理落点**：`D:\cursor\小马哥时政历史\brain\`（项目内，照笔记本 `./output/brain-*` 的「产出落项目旁」惯例）。
- 网络备注（中国区）：codeload CDN 通常可达；若主域被墙，CDN 节点一般仍通。下载失败时记录到日志，人工换节点重试。

### 阶段 1 · 语料规范化进 `raw/`

- **映射规则**：根目录文件名形如 `<整数>.<标题>.md` → 拷贝为 `小马哥知识库/raw/<整数>.md`（取首个 `.` 前的前导整数）。无前导整数的文件（如 `知识库设计文档-GBrain编译式RAG.md`）自动跳过。
- **铁律**：`raw/` 仍为只读源真相；本步是「拷入」，拷入后不再改原文。已有 137/138/141 保留，全量重拷以统一。
- **空壳检测**：去掉标题行 / 空行 / 纯元数据行（如「录制时间」）后，正文有效中文字数 `< 300` 判为空壳候选 → **不拷入 `raw/`**，并在 `wiki/index.md` 的「缺正文清单」登记编号。
  - **校验**：空壳候选总数应接近设计预期的 **47 篇**；偏差过大（如 <30 或 >65）说明阈值或检测有问题，须人工复核后再继续。
- 产物：`raw/` 约 **435** 篇 `NNN.md`；`index.md` 缺正文清单约 47 条。

### 阶段 2 · 折叠 3 条 pilot learnings

1. **frontmatter 加 `created`**：6 类页 frontmatter 在原有 `title/type/sources/updated` 基础上**新增 `created`（编译日期）**——gbrain-base 必填。须同步写进 `CLAUDE.md`/`AGENTS.md` 的页面类型表。**全量为权威**：Phase 1 重编全部 ~435 篇（含 pilot 137/138/141），覆盖既有 28 页并统一带 `created`；为避免陈旧合并，Phase 1 前先清空 `wiki/` 下 6 类目录（`people/orgs/countries/events/takes/sources`），保留 `index.md`/`log.md`/`aliases.md`。
2. **import 排除 `aliases.md`**：`aliases.md` 是工具词典非知识页，不应入库。建图前从 import 目标排除（移出 `wiki/` 顶层或 import 时排除该文件）。
3. **接受 mentions-only**：本轮不追求 typed 语义边（见 §10），schema 关系动词仍按括注写，仅作人读语义，不指望 self-wiring 类型化。

### 阶段 3 · 工具链冒烟（pilot-of-one）

正式批跑前，用**单篇**（建议复用 137）跑一次 `codex exec`，确认：Codex 能 headless 读 schema + 写出合规 wiki 页、`raw/` 未被改、退出码正常。通过后再进 Phase 0 全量。失败则先修工具链，不进全量。

### 阶段 4a · Phase 0 全量抽实体（Codex）

- PowerShell 驱动器分批（10–15 篇/批）跑 `codex exec`：「**只列 person/org/country，不写任何 wiki 页**」，输出 `候选slug | type | 别名/全称` 到**每批独立的候选文件**（如 `wiki/.aliases-candidates/batch-NNN.txt`），**不直接追加 `aliases.md`**——保证 Claude 拿到的是原始候选、由 Claude 统一裁决。
- Codex 此步只做机械列举，不做跨批去重、不定 slug 终值（终值由 4b 决定）。

### 阶段 4b · 严谨维护并冻结 `aliases.md`（Claude Code · 命门）

aliases.md 是整个 slug 一致性的命门，由 Claude **严谨维护**，规则：
- **归并**：跨批同一实体的所有别名/全称收进一行（如「美国, 美利坚, 美方, 美」）。
- **去重**：同实体绝不出现两个规范 slug（防「王安石 / 安石」「美联储 / Fed」分裂）。
- **slug 规范化**：中文走拼音连字符（王安石→`wang-anshi`、广场协议→`plaza-accord-1985`）；带目录前缀（`people/` `orgs/` `countries/`）。
- **冲突裁决**：候选里同名异指 / 异名同指，由 Claude 逐条判定，疑难记 `wiki/log.md` 留痕。
- **并入 pilot**：现有冻结词典（6 人 / 8 国 / 3 组织）作为子集并入，slug 保持不变。
- **冻结**：产出标注冻结时间的 `aliases.md`；**Phase 1 期间只读不改**，漏的实体由 Codex 记 `log.md`、本轮不补。
- 冻结前自检：每行格式合法、无重复 slug、人/国/组织三类覆盖样本篇目。

### 阶段 5 · Phase 1 全量写页（Codex · 全自动）

- PowerShell 驱动器分批跑 `codex exec`：「按 `CLAUDE.md` 把本批文稿编译为 主体/事件/观点/source 页」。
- 写 `[[链接]]` **只查冻结 `aliases.md` 用规范 slug，不改它**；漏的实体记 `wiki/log.md` 待补。
- 每篇必生成一个 `source` 页作为引用锚点。

### 阶段 6 · 建图（Claude Code · 严格照笔记本 §4，全程 `--no-embedding`）

```powershell
gbrain init --pglite --no-embedding --force --path D:\cursor\小马哥时政历史\brain --non-interactive
gbrain import D:\cursor\小马哥时政历史\小马哥知识库\wiki --no-embed
gbrain extract links --source fs --dir D:\cursor\小马哥时政历史\小马哥知识库\wiki
```
- **单活动库模型**：`init` 把库登记进 `~/.gbrain/config.json` 的 `database_path`；其后 `import`/`stats`/`graph`/`backlinks` 默认作用于活动库，传 `--path` 也被忽略。故先 `init` 再依次跑。
- `extract links` 用 **`--source fs --dir`**（笔记本指定；本库链接为带前缀 `[[countries/united-states]]` 形式，fs 模式稳妥）。
- import 目标排除 `aliases.md`（见阶段 2）。

### 阶段 7 · 验证（Claude Code · 建图后）

```powershell
gbrain stats            # Pages / Links / Embedded 0
gbrain graph wang-anshi # 抽查节点连边
gbrain backlinks federal-reserve
```
Claude 验证项：0 断链、`stats` 规模合理、slug 跨篇一致（无分裂节点）、噪声残留抽检、随机 5 个 take 的 `claim` 忠实度与 `derived_from` 可追溯到原文。不达标 → 定位是 schema/词典/写页问题 → 退回对应阶段重跑。

## 5. 给 Codex 的交接结构（背景 + 边界 + 要求）

Codex 有**两次**调用：4a 抽实体、5 写页。每批 prompt 必含三块（这是用户的核心诉求）。

**共同的背景 + 边界（两次都给）：**
- **背景**：`CLAUDE.md` 全文（schema）+ 本批原文 + 一句范式说明（编译式 RAG / LLM Wiki）。
- **执行边界（铁律）**：`raw/` 只读绝不改；只写指定目标；不碰 gbrain、不跑建图、不装依赖（建图由 Claude 在 Codex 批跑之后统一做）。

**4a 抽实体（Codex）专属要求：**
- 只列 person/org/country 三类，**不写任何 wiki 页、不改 `aliases.md`**。
- 输出 `候选slug | type | 别名/全称` 到本批独立候选文件（`wiki/.aliases-candidates/batch-NNN.txt`）。
- 机械列举即可，跨批去重与 slug 终值留给 Claude（4b）。

**5 写页（Codex）专属要求：**
- 额外背景：**冻结版 `aliases.md`**（4b 产物）。
- 边界补充：写 `[[链接]]` **只查冻结 `aliases.md` 用规范 slug，不改它**；漏的实体记 `log.md`；每篇生成对应 `source` 页。
- 要求：6 类页 frontmatter 齐全（含新增 `created`）；噪声过滤（丢开场寒暄 / 结尾导流 / 口语重复）；take 必带 `by: 马永谙` + `derived_from`；消歧规则（take vs fact / 何时建实体页 / event 粒度）照 `CLAUDE.md` 正反例。

## 6. 驱动器：`compile-batch.ps1`（Windows-native 重写）

把 `小马哥知识库/compile-batch.sh` 重写为 PowerShell（因本机 bash fork 失败），执行者固定 Codex：
- 用法：`./compile-batch.ps1 -Phase entities|pages [-Batch 12]`。
- `-Phase entities`（4a）：每批 prompt = schema + 本批原文 + §5「4a 专属要求」→ Codex 输出到 `wiki/.aliases-candidates/batch-NNN.txt`（**不读/不写 `aliases.md`**）。
- `-Phase pages`（5）：每批 prompt = schema + **冻结 `aliases.md`** + 本批原文 + §5「5 专属要求」→ Codex 写 `wiki/` 页。
- 分批（默认 12 篇）；每批指纹（文件名 hash）记 `.done/`，重跑自动跳过 → **断点续跑**。
- 调用：`codex exec "<prompt>" -C <KB> --dangerously-bypass-approvals-and-sandbox`。
- 失败记 `.compile-log` 不中断，整轮跑完再回看失败批重跑。

## 7. 成功标准

- ~435 篇编译完成；`gbrain stats` 显示合理 pages/links 规模；**0 断链**。
- 同一实体跨篇 slug 一致（无「王安石/安石」双节点）。
- 随机抽 5 个 take，`claim` 忠实原文、`derived_from` 能一路追回原文。
- `gbrain --version` 为 0.42.x；建图三命令均成功。

## 8. 验证图（每阶段对应验证手段）

| 阶段 | 验证手段 |
|---|---|
| 0 部署 | `gbrain --version` == 0.42.x |
| 1 语料 | `raw/` 计数 ≈435；空壳清单 ≈47（偏差大则复核） |
| 2 learnings | 抽页含 `created`；import 不含 aliases |
| 3 冒烟 | 单篇产出合规、`raw/` 未改 |
| 4a 抽实体 | 候选文件覆盖样本人/国/组织 |
| 4b 冻词典 | `aliases.md` 无重复 slug、别名归并正确、自检通过 |
| 5 Phase 1 | 页带 frontmatter（含 `created`）+ `[[链接]]` + `derived_from`；slug 一致 |
| 6 建图 | `stats` pages/links 合理、0 断链；`backlinks` 可追溯 source |
| 7 验证 | 5 take 忠实可追溯 |

## 9. 失败模式与处置

| codepath | 失败场景 | 处置 |
|---|---|---|
| 阶段 0 下载 | codeload 节点不通 | 日志记录，人工换节点/tag 重试 |
| 阶段 0 安装 | `--version` 显示 1.3.1 / 安装中断 | 确认走的是源码+bun install+bun link 路径，重装 |
| 阶段 0 链接 | 旧 0.41.29.0 的 `gbrain.exe` 仍被 PATH 优先命中 | 移除旧软链 / 确认 `~/.bun/bin` 新链接优先；以 `gbrain --version` 为准 |
| 阶段 1 空壳 | 阈值误判（数量偏离 47） | 人工复核阈值与候选清单后再继续 |
| Phase 0/1 批失败 | 某批崩 → 页缺失 | `.compile-log` + `.done` 断点续跑，跳过已完成、重试失败 |
| 阶段 6 import | 误把 `aliases.md` 入库 | 排除该文件后重 import |
| 阶段 6 extract | db 模式建 0 边 | 用 `--source fs --dir`（已固定） |

## 10. 已知限制（诚实划界）

self-wiring 是确定性正则、只认特定**英文**关系动词（founded/invested_in/advises/works_at…）。本库链接的关系动词以中文括注书写，**本轮不会成为 typed 边，将全部落 `mentions`**。typed 语义边（caused/about/opposes）留作未来增强（需 LLM 抽边或改写链接格式），不在本轮范围。

## 11. 开放问题（不阻塞本轮）

- 空壳字数阈值 300 是初值，阶段 1 实跑后据真实分布微调（以贴近 47 篇为准）。
- 观点去重粒度：同一论断多篇重复，倾向**合成一个 take 页**（sources 累积），全量中观察后定。
