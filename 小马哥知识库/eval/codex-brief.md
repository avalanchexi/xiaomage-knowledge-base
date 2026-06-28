# Codex 执行简报 · T7 质量闸「识别 pass」

> 把本文件整段贴给 Codex（`codex exec` 或交互式 TUI），在 `小马哥知识库/` 目录下运行。
> 这是**交叉校验的第一棒**:你（Codex）只做客观、机械、可复核的"识别"工作,**不下过线判定**。
> 最终的语义裁决与过线/未过线由另一个独立模型(Claude)在 `claude-adjudication.md` 完成。

---

## 背景

`小马哥知识库/` 是把 435 篇马永谙《小马哥财道》口语稿编译成的互链 wiki。目录:

- `raw/<no>.md` — 原文(只读·源真相,UTF-8)。`<no>` 为文章编号。
- `wiki/sources/<no>.md` — 每篇原文对应的 source 页(引用锚点)。
- `wiki/{people,orgs,countries,events,takes}/<slug>.md` — 抽取产物,页内用 `[[类型/slug]]` 互链。
- `wiki/aliases.md` — **冻结的规范名词典**(slug 命门)。
- `CLAUDE.md` / `AGENTS.md` — schema 规则层(6 页面类型 + frontmatter 字段 + 关系动词 + slug 规则 + 消歧 few-shot)。

**重要纪律**:这批页面此前是由你(Codex)编译的。为避免"自己批改自己作业",本 pass 你**只做机械检查 + 对原文的独立盲抽**,把"这条 take 忠不忠实原文"的语义判断**留给 Claude**。

## 输入

- 待评样本:`eval/sample-A.txt`(调 prompt 阶段)或 `eval/sample-B.txt`(验收阶段)。文件里每行一个 `<no>`,`#` 开头是注释。
- 评测时**只处理样本里的 `<no>`**,逐篇独立产出。
- **范围铁律**:本次只处理被指定的那一个样本文件(`sample-A.txt` 或 `sample-B.txt` 其一)里的 `<no>`,**不得**自行扩展到另一样本或样本外编号。

## 每篇文章要做的 4 件事

对样本中的每个 `<no>`:

### 1. 完整性检查(机械)
- `wiki/sources/<no>.md` 是否存在;frontmatter 是否含 `title/type/article_no/发布时间/来源/created/updated`,列出缺失字段。
- 找出"`derived-from` 指向 `sources/<no>`"的所有页面(它们是这篇衍生出的产物)。对这些页面:
  - 页内每个 `[[类型/slug]]` 链接的目标文件是否真实存在(断链=目标文件不存在)。
  - frontmatter 是否齐全(按 `CLAUDE.md` 各类型的必填字段)。

### 2. 盲抽(独立重抽,先别看已编译页)
- **只读 `raw/<no>.md`**,凭原文列出你认为**应当**被抽出的:
  - `takes` — 马永谙的核心观点/论断(一句话 claim)。
  - `events` — 事件(名称 + actors + cause + effect 要素)。
  - `people` / `orgs` / `countries` — 出现的主体。
- 过滤掉寒暄("大家好欢迎收听")、铺垫、口语重复,只列干货。

### 3. 盲抽 vs 已编译页 对比
- 把第 2 步的盲抽结果与第 1 步找到的实际 wiki 页对照:
  - `missing_in_wiki` — 原文有、但 wiki 漏抽的(分 takes/events/entities)。
  - `extra_in_wiki_not_in_raw` — wiki 页里有、但你在原文找不到依据的(**疑似幻觉,标出来交给 Claude 裁决,你不下结论**)。

### 4. slug 一致 + 噪声扫描
- 对这篇涉及的每个实体:wiki 用的 slug 是什么?是否在 `aliases.md` 内?有无该实体在别处落了不同 slug 的迹象(如"王安石/安石"分裂)。
- 噪声扫描:这篇衍生的 wiki 页正文里有没有寒暄/铺垫/口语重复残留,给出例句。

## 输出

为每个 `<no>` 写一个文件 `eval/codex-findings/<no>.json`,严格用下面的 schema(只填事实,`severity_guess` 是建议,最终定级归 Claude):

```json
{
  "article_no": 137,
  "raw_title": "原文标题",
  "eval_pass": "codex-identify",
  "completeness": {
    "source_page_exists": true,
    "frontmatter_complete": true,
    "frontmatter_missing_fields": [],
    "pages_derived": ["takes/financial-war-is-national-destiny", "events/..."],
    "broken_links": [{"page": "takes/xxx", "link": "[[people/yyy]]", "reason": "目标文件不存在"}],
    "derived_from_resolves": true
  },
  "blind_extraction": {
    "takes": ["盲抽得到的观点1", "..."],
    "events": [{"name": "...", "actors": ["..."], "cause": "...", "effect": "..."}],
    "people": ["..."], "orgs": ["..."], "countries": ["..."]
  },
  "page_vs_blind": {
    "missing_in_wiki": {"takes": ["..."], "events": ["..."], "entities": ["..."]},
    "extra_in_wiki_not_in_raw": [{"page": "takes/xxx", "claim": "...", "why_suspicious": "原文未提及"}],
    "notes": "..."
  },
  "slug_consistency": [
    {"entity": "王安石", "slug_used": "wang-anshi", "in_aliases": true, "consistent": true, "note": ""}
  ],
  "noise_scan": {"residue_found": false, "examples": []},
  "codex_flags": [
    {"severity_guess": "中", "type": "漏抽", "detail": "原文核心观点 X 未建 take 页"}
  ]
}
```

定级词表(供 `severity_guess` 参考,最终由 Claude 定):
- **严重** — 幻觉(原文无依据的 claim)/ 张冠李戴(主体或归属错)/ `derived-from` 指错原文。
- **中** — 漏抽关键观点 / 事件要素(actors/cause/effect)错或缺。
- **轻** — 噪声残留 / slug 小不一致 / frontmatter 小缺字段。

## 收尾

- 全部样本处理完,运行 `eval/regen-index.ps1` 重建累计 `_index.json`(包含 A+B 样本);不要手写或覆盖 `_index.json`。
- **不要**写 `verdict.md`、不要给过线结论——那是 Claude 的活。
- 只写 `eval/codex-findings/` 下的文件,**不得改动 `raw/`、`wiki/`、`aliases.md`**。
