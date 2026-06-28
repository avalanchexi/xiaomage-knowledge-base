# Claude 执行简报 · T7 质量闸「复合 pass」(裁决)

> 在 Codex 的「识别 pass」跑完、`eval/codex-findings/<no>.json` 就位后,把本文件整段贴给一个 **Claude** 会话,在 `小马哥知识库/` 目录下运行。
> 这是**交叉校验的第二棒**:你(Claude)是**未参与编译的独立模型**,负责语义裁决与最终过线判定。

---

## 背景与分工

`小马哥知识库/` 详见 `eval/codex-brief.md`。这批页面由 Codex 编译、Codex 也已跑完机械「识别 pass」。你现在做两件 Codex 不该自评的事:

1. **语义忠实度裁决** —— take 的 claim 是否忠实原文、有无幻觉/张冠李戴、`derived-from` 是否指对。
2. **最终定级 + 过线判定** —— 复核并改写 Codex 的 `severity_guess`,套严格档算过线/未过线。

## 输入

- 样本清单:`eval/sample-A.txt` 或 `eval/sample-B.txt`(与 Codex 跑的同一份)。
- 每篇的 `eval/codex-findings/<no>.json`(Codex 的机械结果 + 盲抽)。
- `raw/<no>.md`(原文)、其衍生的 `wiki/**` 页、`CLAUDE.md`、`wiki/aliases.md`。

## 每篇要做的事

对样本中每个 `<no>`:

1. 读 `raw/<no>.md` + 该篇衍生页 + `codex-findings/<no>.json`。
2. **裁决 `extra_in_wiki_not_in_raw`** 里 Codex 标的疑似幻觉:逐条回原文核对,判定是真·幻觉(严重)还是原文确有依据(无问题)。
3. **逐 take 核忠实度**:对每个 `derived-from: sources/<no>` 的 take,核 `claim` 是否忠实原文、`by: 马永谙` 归属对不对、`derived-from` 指对没有。
4. **复核漏抽**:Codex 的 `missing_in_wiki` 是否成立(关键观点/事件要素是否真漏)。
5. **定级**:对每条问题给最终 `严重/中/轻`(词表见 `codex-brief.md` 收尾节),可推翻 Codex 的 `severity_guess`。

## 聚合与过线规则(严格档)

跨样本汇总,按下面口径算四个指标:

| 指标 | 口径 | 阈值 |
|---|---|---|
| 严重问题 | 全样本严重问题计数 | **= 0** |
| 中级命中率 | 中级问题数 ÷ 抽样总(take+event)条数 | **≤ 5%** |
| slug 跨篇一致 | 一致的实体引用数 ÷ 总实体引用数 | **≥ 98%** |
| 噪声残留 | 有寒暄/铺垫残留的页数 ÷ 抽样总页数 | **≤ 5%** |

**任一不达标 → 未过线。** 过线 = 四项全达标。

## 输出 `eval/verdict.md`

```markdown
# T7 质量闸裁决 · 样本<A|B> · <日期>

## 判定:过线 / 未过线

## 指标
- 严重: <n>（阈值 0）
- 中级命中率: <x>%（阈值 ≤5%,分母 <take+event 总数>）
- slug 一致率: <x>%（阈值 ≥98%）
- 噪声残留率: <x>%（阈值 ≤5%）

## 返工清单（按严重度排序）
| # | 严重度 | 类型 | 文章 | 页面 | 问题 | 建议修法 |
|---|---|---|---|---|---|---|
| 1 | 严重 | 幻觉 | 137 | takes/xxx | ... | 删/改 claim |

## 备注
- 与上一轮(若有)的指标对比,说明 prompt 迭代是否改善。
```

## 纪律

- 只写 `eval/verdict.md`,**不改** `raw/`、`wiki/`、`aliases.md`。
- 未过线时,返工清单是 agent 回到管线第 1 步(调 schema/prompt 或补抽)的依据。
- 同一样本跨轮复跑,指标口径不变,才能比较 prompt 迭代是否真的改善(D7)。
