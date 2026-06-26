---
title: 变更日志
type: log
updated: 2026-06-26
---
- 2026-06-26 · Phase 0：冻结 aliases.md（金融战簇 137/138/141）
- 2026-06-26 · Phase 1：编译 3 源 / 8 国 / 3 组织 / 6 人物 / 5 事件 / 3 观点
- 待补(复现时入 aliases)：克鲁格曼、朴正熙、文在寅、李在镕、新桥资本、孤星基金等次要实体
- 2026-06-26 · Pilot 跑通：gbrain import 31 页 / extract links 110 边 / 0 断链；图谱可查可追溯
- Pilot learnings：①各页 frontmatter 应加 created（gbrain-base 必填）②aliases.md 应排除出 import（工具非知识页）③self-wiring 仅产 mentions 边，语义动词(caused/about)在正文未成类型化边
- 2026-06-26 · Phase 0 全量冻结 aliases.md（4295 实体；疑难裁决见下）
- 疑难裁决：保留同名异指，不强行归并：古罗马/罗马/罗马帝国（共和国、帝国、泛称），朝鲜（朝鲜王朝、朝鲜半岛/民族、北朝鲜），蒙古（蒙古国、蒙古帝国、蒙古人），宋朝/汉朝（全朝代 vs 分期），台湾/台湾当局，英格兰/英国/大英帝国，俄国/沙俄（现代俄罗斯 vs 俄罗斯帝国）。
- 疑难裁决：组织类同名按上下文保守拆分：Facebook/Meta，央行/民国中央银行，中国/美国/日本/韩国同名部委，国会/众议院/财政部/商务部/国防部等跨国机构名，民主党/共和党/社会党/共产党/国民政府等跨政权党政名。
- 疑难裁决：纯拼音/缩写/全称高置信拆分已并入规范 slug；其余短别名冲突留待 Phase 1 写页时按原文上下文判定，漏项只记 log.md 不改冻结词典。
- 2026-06-26 · Task 6 review fix：合并普京/奥巴马/欧盟/苹果/马云等高置信 split slug；删除剩余跨 slug 裸 alias token 与空别名行；当前 cross_slug_duplicate_aliases=0。
- 2026-06-26 · Task 6 re-review fix：Phase 1 linkable dictionary 排除通用一字国名简称与跨语境裸 alias（如 中/美/英/日/俄/德/法/韩、中央/中央政府、PBoC 裸「央行」）；仅保留显式可判定别名。
