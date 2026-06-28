# T7 质量闸裁决 · 样本A · 2026-06-28

## 判定:过线 ✅(严格档四项全达标)

## 指标
- 严重: 0(阈值 0)
- 中级命中率: 0%(阈值 ≤5%;分母 = 抽样 ~55 个 take+event 单元;Codex 自身 missing_in_wiki.takes/events 全为 0,无核心观点/事件漏抽)
- slug 一致率: 100%(阈值 ≥98%;0 断链、0 分裂节点、Codex slug_consistency 全 in_aliases)
- 噪声残留率: 0%(阈值 ≤5%;8 篇 noise 全 clean,take 页均剔除寒暄/导流)

## 裁决要点(cross-model)
Codex 共提 ~13 条 flag(多标"中"),独立裁决后全部降级为轻,无一 gating。两类系统性原因:
1. 多源合成被误报为幻觉:5 个 extra_in_wiki_not_in_raw 中 4 个所在页为多源(141 [79,100,105,141]、123 [123,132]、121 [52,121,122,379]、135 [44,135]),正文均透明标注各源贡献 → 非单篇幻觉。
2. "missing extraction(中)" 实为粒度/归属偏好:与 Codex 自身 missing_in_wiki.takes=events=0 矛盾;CLAUDE.md 反对过度拆分 event + 次要实体"只提及不建页" → 非缺陷。

## 返工清单(全为轻,非 gating,作打磨 backlog)
| # | 严重度 | 类型 | 文章 | 页面 | 问题 | 建议 |
|---|---|---|---|---|---|---|
| 1 | 轻 | 多源 claim 措辞 | 137/138/141/135 | 对应多源 take | claim 含 co-source 词(SWIFT/CHIPS、World Bank、意识形态领袖),正文已透明 | claim 可注明跨源,或不动 |
| 2 | 轻 | 选择性实体 | 137 | orgs/bilibili | bilibili 关联 137,但同列暴跌的腾讯/阿里未关联 137,判定不齐 | 统一"只提及不建页"边界 |
| 3 | 轻 | event cause 推断 | 120 | events/shanghai-unemployment-insurance-surge-2021(单源) | cause 含"产业调整",raw 120 该词 0 次(失业保险/就业/上海 均扎实) | cause 去掉/弱化"产业调整" |

## 备注
- 完整性层(确定性脚本)已独立 PASS:raw↔source 1:1、0 空壳、0 断链、frontmatter 齐全 —— 与 Codex completeness 互相印证。
- 样本A 目的(调 prompt 收敛)达成:briefs 让 Codex 产出合规结构化 findings,裁决能干净区分 gating vs 轻 → briefs 可冻结,进样本B 验收。
- 方法:先 raw 盲判 → 再开 findings 交叉 → 按严格档定级,保独立性。
