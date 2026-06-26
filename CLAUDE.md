# 小马哥时政历史知识库 — 编译规则层（schema）

> 这是 LLM 编译器（Claude Code / Codex）把 `raw/` 文稿编译成 `wiki/` 知识页时必须遵守的规则。
> 范式：编译式 RAG / LLM Wiki（Karpathy）+ GBrain 落地。
> **铁律：`raw/` 只读，绝不改动；所有写入只落 `wiki/`。**

## 三层
- `raw/`      原料层：马永谙《小马哥财道》文稿（只读，源真相）
- `wiki/`     知识层：编译产物（你写），互相用 `[[链接]]` 连接
- `CLAUDE.md` 规则层：本文件（人类撰写）

## 页面类型（6 种）

每页 frontmatter 必带：`title` / `type` / `sources`(原文编号数组) / `updated`。
slug 一律小写拼音连字符，放对应子目录。

| type | 目录 | 说明 | 额外 frontmatter |
|---|---|---|---|
| `person` | `people/` | 人物（历史/现实，不分古今） | `aliases[]`, `role` |
| `org` | `orgs/` | 组织/机构/公司/联盟 | `aliases[]`, `kind` |
| `country` | `countries/` | 国家/政权 | `aliases[]` |
| `event` | `events/` | 具体事件（含协议、危机、变法、战争） | `date`, `actors[]`, `cause`, `effect` |
| `take` | `takes/` | 马永谙的观点/论断（**非客观事实**） | `claim`, `by`, `topic`, `derived_from[]` |
| `source` | `sources/` | 原文（每篇一页，引用锚点） | `article_no`, `published`, `origin` |

## 关系动词（写在正文的 `[[链接]]` 处用括注标明）
`mentions`(默认) · `participates-in`(主体→事件) · `about`(观点→主体/事件) · `opposes`(对立) · `caused`(事件→事件) · `part-of`(从属) · `derived-from`(任何→`sources/NNN`) · `supports` / `contradicts`(观点↔观点)

## slug 规范化（命门）
- 写任何 `[[链接]]` 前，**先查 `wiki/aliases.md`**；命中别名 → 用其规范 slug。
- 中文名走拼音：王安石→`wang-anshi`，苏联→`soviet-union`，广场协议→`plaza-accord-1985`。
- 两阶段纪律：**Phase 0** 只抽实体、产出冻结的 `aliases.md`；**Phase 1** 写页时**只读不改**它（新实体若漏，记到 `wiki/log.md` 待补，不要擅自改冻结词典）。

## 消歧规则（避免 435 篇分类漂移）

### take vs fact（最易混）
- **take**：马永谙的判断/预测/价值主张，含"我认为 / 必须 / 本质上 / 不过是"等立场词。→ 建 `takes/` 页，必带 `by: 马永谙` + `derived_from`。
- **fact（不单独建页）**：可核验的客观事件/数据（"日经从近 4 万跌到 14000"）。→ 写进相关 `event` 页的 `cause`/`effect` 或正文，不建 take 页。
- 判据：去掉"马永谙认为"后**仍成立 = fact；不成立 = take**。

### 何时建 entity 页
- **建页**：在文中承担因果角色、或跨篇复现的主体（美国、美联储、里根）。
- **只提及不建页**：一句话带过、对论证无结构作用的次要人物（仅作引用），留待复现时再建。
- 拿不准 → 建页（**宁可多建，lint 阶段再合并**）。

### event 粒度
- 一个有明确时间 / 参与方 / 因果的历史片段 = 一个 event（广场协议 1985、苏联石油绞杀 1985-91）。
- 同一事件的子情节不拆页，写进该 event 正文。
- 反复出现的"手法/模式"（美元潮汐的三波收割）**不是 event，是 take 的论据**。

## 正反例（few-shot）
- ✅ take：「世界货币必须建立在军事霸权之上」→ `takes/world-currency-needs-military`，`claim` 一句话，`by: 马永谙`，`derived_from: [141]`，正文 `about [[countries/united-kingdom]]` `[[countries/united-states]]`。
- ✅ event：广场协议 → `events/plaza-accord-1985`，`date: 1985`，`actors: [[countries/united-states]] [[countries/japan]]`，`cause` 美国打压日本，`effect` 日元升值 75%、日本"失去的二十年"。
- ✅ entity 复用：美国在 137/138/141 都出现 → **唯一一页** `countries/united-states`，`sources: [137,138,141]`。
- ❌ 别把"日经跌 70%"建成 take（这是 fact，写进 `events/plaza-accord-1985` 的 `effect`）。
- ❌ 别为"苏联"和"苏联解体"建两个 country 页（解体是 event，苏联是 country）。

## 噪声过滤
丢弃：开场"大家好欢迎收听"、结尾"订阅点赞 / 公众号马马道来"、口语重复与铺垫。只留主体 / 事件 / 观点干货。
