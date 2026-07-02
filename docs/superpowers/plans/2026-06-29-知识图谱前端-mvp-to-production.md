# 知识图谱前端 MVP → 生产形态 实现计划（M2–M6）

> **For agentic workers (Codex):** 本计划交给 OpenAI Codex 冷启动执行——你没有对话上下文，**所有信息以本文件 + 仓库内被引用的源文件为准**。逐任务执行，步骤用 `- [ ]`。每个任务跑测试 + 提交。遇到与本文件矛盾的现实（源码/接口不符），**停下报告**，不要自行猜测改方向。

**Goal:** 把已能跑的单文件 MVP（`知识图谱前端-wireframe.html`）重构成设计文档锁定的生产形态：Vite + TS 工程 + 单 Node 服务，图谱渲染换 Cytoscape（fcose/dagre），接入 DeepSeek 意图层（带本地降级），完成 M2–M6。

**Architecture:** 离线构建脚本（M1 已完成）把 wiki 解析成 `graph-index.json`/`search-index.json`；浏览器端纯逻辑模块 `graph.ts` 做实体解析 + BFS/最短路组装（无运行时智能、内容只来自 wiki）；`render.ts` 用 Cytoscape 渲染；`intent.ts` 调本地 `/api/intent` 代理（`server.mjs` 持 DeepSeek key）把自然语言转成查询计划，失败则降级到本地模糊搜索。单进程 `server.mjs` 同时托管静态产物与 `/api/intent`。

**Tech Stack:** Vite 5 · TypeScript · Cytoscape.js + cytoscape-fcose + cytoscape-dagre · Fuse.js · Node ≥18 (http + fetch) · Vitest（jsdom）。

**权威来源（Codex 必须先读）：**
- `知识图谱前端设计.md`（产品/架构/评审总纲，尤其 §5 结构、§6 DeepSeek、§7 清晰图谱、§13 工程结论、§14 设计结论）
- `知识图谱前端-wireframe.html`（**可工作的 MVP，约 1100 行**；本计划大量"移植"指的是从此文件提取函数。先通读它）
- `graph-web/scripts/build-graph.mjs`（M1 已完成，**勿改逻辑**，只加测试）
- `graph-web/public/data/graph-index.json` / `search-index.json`（M1 产物；若不存在，先 `cd graph-web && npm run build:graph` 生成）

---

## 边界与硬约束（Codex 必读，违反即错）

1. **只读区**：`小马哥知识库/raw/**` 与 `小马哥知识库/wiki/**` **绝对只读**，任何任务都不得写入/修改（wiki 的 CLAUDE.md 铁律）。
2. **图谱内容只来自 wiki**：节点/边一律来自 `graph-index.json`。**DeepSeek 永不生成节点或边**，只产出"查询计划"。
3. **Key 安全**：`DEEPSEEK_API_KEY` 只允许出现在 `graph-web/.env` 与 `server.mjs` 进程内；**绝不可**打进前端 bundle、绝不可提交 git（`.env` 已在 `.gitignore`）。前端只调本地 `/api/intent`。
4. **M1 不重做**：`build-graph.mjs` 已完成并验证，只为它补测试，不改其解析逻辑。
5. **既有工程**：`graph-web/` 已存在（`package.json`、`.gitignore`、`scripts/build-graph.mjs`、`public/data/*.json`）。本计划是在其上**增量添加** Vite/源码/服务，不是 `npm create vite` 重建。
6. **环境**：Windows + PowerShell 为主；命令用跨平台写法（`node`/`npx`），路径用正斜杠。文件一律 **UTF-8**。
7. **数据形状（已从 `build-graph.mjs` 确认，types.ts 必须与此一致）**：
   - node：`{ id:string, label:string, type:'person'|'org'|'country'|'event'|'take'|'source', aliases:string[], sources:number[], degree:number, stub?:boolean }`，id 形如 `people/trump`。
   - edge：`{ source:string, target:string, relation:string }`，relation ∈ `mentions|participates-in|about|opposes|caused|part-of|derived-from|supports|contradicts`。
   - search item：`{ id:string, label:string, type:string, terms:string[] }`。

---

## 文件结构（目标）

```
graph-web/
├─ .env.example            # 模板（真 .env 由用户填，gitignore）
├─ .gitignore              # 已存在，追加 (见 T1)
├─ package.json            # 已存在，扩充 deps+scripts (T1)
├─ tsconfig.json           # 新增 (T1)
├─ vite.config.ts          # 新增 (T1)
├─ index.html              # 新增：Vite 入口 (T2)
├─ server.mjs              # 新增：托管 dist/ + /api/intent (T10)
├─ scripts/build-graph.mjs # 已存在 (M1)；T0 补测试
├─ public/data/*.json      # M1 产物
├─ src/
│  ├─ types.ts             # 共享类型 (T3)
│  ├─ data.ts              # 载 index、建邻接、Fuse 解析 (T4,T5)
│  ├─ assemble.ts          # 纯逻辑：BFS/path/cap (T6,T7)
│  ├─ relations.ts         # schema→中文、type→{shape,color,中文} 单一数据源 (T3)
│  ├─ render.ts            # Cytoscape 实例 + 详情面板 + 图例 + 历史 + wiki 模态 (T8,T9,T13)
│  ├─ intent.ts            # /api/intent + 降级 + plan 缓存 + 历史持久化 (T11)
│  └─ main.ts              # 入口：装配事件，串 搜索→意图→组装→渲染→历史 (T9,T12)
└─ tests/
   ├─ build-graph.test.ts  # T0
   ├─ assemble.test.ts     # T6,T7
   ├─ data.test.ts         # T5
   ├─ relations.test.ts    # T3
   └─ intent.test.ts       # T11
```

---

## Task 0: 给 build-graph.mjs 补测试（数据正确性是地基）

**Files:**
- Create: `graph-web/tests/build-graph.test.ts`
- Create (fixture): `graph-web/tests/fixtures/wiki/` (合成微型 wiki)
- Modify: `graph-web/package.json`（T1 已加 vitest；本任务假设 T1 先做——**先做 T1 再做 T0**）

> 顺序提示：**先 T1（脚手架带 vitest），再回到 T0**。这里列在前是因为它逻辑上是地基。

- [ ] **Step 1: 造合成 wiki fixture（覆盖各类型 + 悬空 + CRLF + 一行多目标）**

创建文件（CRLF 用 `\r\n` 字面写不便，改为：在 fixture 里只放 LF；CRLF 行为单独用一个内联字符串测，见 Step 3 备注）：

`graph-web/tests/fixtures/wiki/aliases.md`:
```
# 测试词典
people/trump        | person  | 川普, 懂王, 川建国
countries/china     | country | 中国, 我国
```
`graph-web/tests/fixtures/wiki/people/trump.md`:
```
---
title: 特朗普
type: person
sources: [2, 4]
aliases: [川普, 懂王]
---
# 特朗普
## 关系
- participates-in [[events/trade-war]]
- about [[takes/maga]]
- derived-from [[sources/2]] [[sources/4]]
```
`graph-web/tests/fixtures/wiki/events/trade-war.md`:
```
---
title: 贸易战
type: event
sources: [2]
actors: ["[[people/trump]]", "[[countries/china]]"]
---
# 贸易战
## 关系
- caused [[events/missing-page]]
- derived-from [[sources/2]]
```
`graph-web/tests/fixtures/wiki/countries/china.md`:
```
---
title: 中国
type: country
sources: [2]
aliases: [中国, 我国]
---
# 中国
## 关系
- derived-from [[sources/2]]
```
`graph-web/tests/fixtures/wiki/takes/maga.md`:
```
---
title: MAGA 路线
type: take
sources: [4]
---
# MAGA 路线
## 关系
- about [[countries/china]]
- derived-from [[sources/4]]
```
`graph-web/tests/fixtures/wiki/sources/2.md` 与 `sources/4.md`：
```
---
title: 源文标题二
type: source
sources: [2]
article_no: 2
---
# 源文标题二
```
（`4.md` 同构，标题"源文标题四"，编号 4。）

- [ ] **Step 2: 让 build-graph.mjs 可被测试调用**

确认 `build-graph.mjs` 已支持 `argv` 指定 wiki 目录（它支持：`wikiArg = args.find(a=>!a.startsWith('--'))`）。测试将以子进程运行它指向 fixture，并写到临时 outdir。**注意**：`build-graph.mjs` 的 `OUT_DIR` 写死为 `../public/data`。为可测，本步给它加一个可选第二参数 `--out <dir>`：

Modify `graph-web/scripts/build-graph.mjs`，在参数解析处（`const VERIFY = ...` 附近）加：
```js
const outArg = (() => { const i = args.indexOf('--out'); return i >= 0 ? args[i + 1] : null; })();
```
并把 `const OUT_DIR = path.resolve(__dirname, '../public/data');` 改为：
```js
const OUT_DIR = outArg ? path.resolve(outArg) : path.resolve(__dirname, '../public/data');
```
（仅此一处，不动解析逻辑。）

- [ ] **Step 3: 写失败测试**

`graph-web/tests/build-graph.test.ts`:
```ts
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const wiki = path.join(here, "fixtures/wiki");
const script = path.join(here, "../scripts/build-graph.mjs");

let graph: any, search: any, report: any;

beforeAll(() => {
  const out = mkdtempSync(path.join(tmpdir(), "kg-build-"));
  execFileSync("node", [script, wiki, "--out", out], { stdio: "pipe" });
  graph = JSON.parse(readFileSync(path.join(out, "graph-index.json"), "utf8"));
  search = JSON.parse(readFileSync(path.join(out, "search-index.json"), "utf8"));
  report = JSON.parse(readFileSync(path.join(out, "build-report.json"), "utf8"));
});

describe("build-graph", () => {
  const node = (id: string) => graph.nodes.find((n: any) => n.id === id);
  const hasEdge = (s: string, t: string, r: string) =>
    graph.edges.some((e: any) => e.source === s && e.target === t && e.relation === r);

  it("parses frontmatter into typed nodes", () => {
    expect(node("people/trump")).toMatchObject({ label: "特朗普", type: "person", sources: [2, 4] });
    expect(node("people/trump").aliases).toContain("懂王");
  });
  it("parses ## 关系 edges (relation + target)", () => {
    expect(hasEdge("people/trump", "events/trade-war", "participates-in")).toBe(true);
    expect(hasEdge("people/trump", "takes/maga", "about")).toBe(true);
  });
  it("derives participates-in edges from event actors", () => {
    expect(hasEdge("people/trump", "events/trade-war", "participates-in")).toBe(true);
    expect(hasEdge("countries/china", "events/trade-war", "participates-in")).toBe(true);
  });
  it("creates stub nodes for dangling links and reports them", () => {
    expect(node("events/missing-page")).toMatchObject({ stub: true, type: "event" });
    expect(report.danglingSample).toContain("events/missing-page");
  });
  it("skips top-level meta files (aliases.md) as entities", () => {
    expect(graph.nodes.some((n: any) => n.id === "aliases")).toBe(false);
  });
  it("builds search index terms from aliases.md + title", () => {
    const item = search.find((s: any) => s.id === "people/trump");
    expect(item.terms).toEqual(expect.arrayContaining(["特朗普", "懂王", "川建国"]));
  });
  it("computes degree", () => {
    expect(node("people/trump").degree).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 4: 跑测试确认先失败再通过**

Run: `cd graph-web && npx vitest run tests/build-graph.test.ts`
预期：先因 `--out` 未实现/路径问题失败 → 完成 Step 2 后全绿。

- [ ] **Step 5: 提交**
```bash
git add graph-web/tests/build-graph.test.ts graph-web/tests/fixtures graph-web/scripts/build-graph.mjs
git commit -m "test(graph-web): build-graph parser tests + --out flag"
```

---

## Task 1: 脚手架 Vite + TS + Vitest（在既有 graph-web 上增量）

**Files:**
- Modify: `graph-web/package.json`
- Create: `graph-web/tsconfig.json`, `graph-web/vite.config.ts`, `graph-web/.env.example`
- Modify: `graph-web/.gitignore`

- [ ] **Step 1: 扩充 package.json**（保留既有 build:graph/verify:trump）

把 `graph-web/package.json` 改为：
```json
{
  "name": "graph-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "description": "小马哥知识库 知识图谱搜索前端",
  "scripts": {
    "build:graph": "node scripts/build-graph.mjs",
    "verify:trump": "node scripts/build-graph.mjs --verify",
    "dev": "node server.mjs --dev",
    "build": "vite build",
    "start": "vite build && node server.mjs",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "cytoscape": "^3.30.0",
    "cytoscape-fcose": "^2.2.0",
    "fuse.js": "^7.0.0"
  },
  "devDependencies": {
    "cytoscape-dagre": "^2.5.0",
    "dagre": "^0.8.5",
    "jsdom": "^25.0.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```
> `cytoscape-dagre` 放 devDeps 是因为 §5 要求"切因果时动态 import"，运行时按需加载；其余前端依赖在 dependencies。

- [ ] **Step 2: tsconfig.json**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: vite.config.ts**（含 dev 时的 /api/intent middleware 复用 server 逻辑；test 用 jsdom）
```ts
import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  build: { outDir: "dist", emptyOutDir: true },
  test: { environment: "jsdom", globals: true, include: ["tests/**/*.test.ts"] },
});
```

- [ ] **Step 4: .env.example**
```
# 复制为 .env 并填入真实 key（.env 已 gitignore，绝不提交）
DEEPSEEK_API_KEY=sk-xxxxxxxx
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL_FLASH=deepseek-v4-flash
DEEPSEEK_MODEL_PRO=deepseek-v4-pro
PORT=4173
```

- [ ] **Step 5: 追加 .gitignore**（确认含以下行，缺则补）
```
node_modules/
.env
.env.*
!.env.example
dist/
public/data/
```

- [ ] **Step 6: 安装依赖 + 生成数据 + 冒烟**

Run:
```bash
cd graph-web && npm install && npm run build:graph
```
预期：`npm install` 成功；`build:graph` 打印"构建完成 / 节点 4296 / 边 14586"（数字以实际 wiki 为准）。

- [ ] **Step 7: 提交**
```bash
git add graph-web/package.json graph-web/tsconfig.json graph-web/vite.config.ts graph-web/.env.example graph-web/.gitignore
git commit -m "chore(graph-web): scaffold vite+ts+vitest on existing project"
```

---

## Task 3: 共享类型 + 关系/类型 单一数据源（DRY）

**Files:**
- Create: `graph-web/src/types.ts`, `graph-web/src/relations.ts`
- Test: `graph-web/tests/relations.test.ts`

- [ ] **Step 1: types.ts**
```ts
export type EntityType = "person" | "org" | "country" | "event" | "take" | "source" | "stub";

export interface GNode {
  id: string; label: string; type: EntityType;
  aliases: string[]; sources: number[]; degree: number; stub?: boolean;
}
export interface GEdge { source: string; target: string; relation: string; }
export interface GraphIndex { nodes: GNode[]; edges: GEdge[]; }
export interface SearchItem { id: string; label: string; type: string; terms: string[]; }

export type Mode = "neighborhood" | "path";
export interface QueryPlan {
  entity_mentions: string[];
  mode: Mode;
  depth: number;                 // 1..3
  relations: "all" | string[];
  includeSources: boolean;
}
export interface AssembleResult {
  mode: Mode;
  nodes: GNode[];
  edges: GEdge[];
  levels: Map<string, number>;
  pathIds: Set<string>;
  truncated: boolean;
  note?: string;
}
```

- [ ] **Step 2: relations.ts（schema→中文、type→{shape,color,中文}，唯一来源）**
```ts
import type { EntityType } from "./types";

export const RELATION_CN: Record<string, string> = {
  "mentions": "提及", "participates-in": "参与", "about": "论及",
  "opposes": "对立", "caused": "导致", "part-of": "隶属",
  "derived-from": "源自", "supports": "支持", "contradicts": "矛盾",
};
export const relationCn = (r: string) => RELATION_CN[r] ?? r;

// 颜色 + 形状双编码（色盲友好）。形状取 Cytoscape 合法值。
export const TYPE_META: Record<EntityType, { cn: string; color: string; shape: string }> = {
  person:  { cn: "人物", color: "#6f55d4", shape: "ellipse" },
  country: { cn: "国家", color: "#2f9b57", shape: "hexagon" },
  event:   { cn: "事件", color: "#3f7fce", shape: "round-rectangle" },
  take:    { cn: "观点", color: "#d98a20", shape: "diamond" },
  org:     { cn: "组织", color: "#1f9d8a", shape: "round-tag" },
  source:  { cn: "原文", color: "#9aa0a6", shape: "ellipse" },
  stub:    { cn: "占位", color: "#c6a15b", shape: "ellipse" },
};
export const typeMeta = (t: string) => TYPE_META[(t as EntityType)] ?? TYPE_META.stub;
```

- [ ] **Step 3: 失败测试 tests/relations.test.ts**
```ts
import { describe, it, expect } from "vitest";
import { relationCn, typeMeta } from "../src/relations";

describe("relations/type mapping", () => {
  it("maps relation schema to Chinese", () => {
    expect(relationCn("participates-in")).toBe("参与");
    expect(relationCn("supports")).toBe("支持");
    expect(relationCn("unknown-x")).toBe("unknown-x");
  });
  it("maps every type to a distinct shape (colorblind aid)", () => {
    const shapes = ["person","country","event","take","org"].map(t => typeMeta(t).shape);
    expect(new Set(shapes).size).toBe(shapes.length); // 形状互不相同
  });
});
```

- [ ] **Step 4: Run** `cd graph-web && npx vitest run tests/relations.test.ts` → 绿。
- [ ] **Step 5: 提交** `git add graph-web/src/types.ts graph-web/src/relations.ts graph-web/tests/relations.test.ts && git commit -m "feat(graph-web): shared types + relation/type single-source maps"`

---

## Task 4: 数据层 data.ts（载入 + 邻接 + 实体解析）

**Files:** Create `graph-web/src/data.ts`; Test `graph-web/tests/data.test.ts`

> 移植来源：`知识图谱前端-wireframe.html` 的 `buildAdjacency`/`pushEdge`、`findMatches`/`normalize`/`uniqueMatches`、`nodeWeight`。改为纯函数 + ES 导出。解析顺序须满足设计 §13-A2：**别名精确 > 标题 > 前缀 > 包含，并列取 degree 高**。

- [ ] **Step 1: 失败测试 tests/data.test.ts**
```ts
import { describe, it, expect } from "vitest";
import { buildAdjacency, resolveMentions } from "../src/data";
import type { GraphIndex, SearchItem } from "../src/types";

const index: GraphIndex = {
  nodes: [
    { id: "people/trump", label: "特朗普", type: "person", aliases: ["懂王","川普"], sources: [], degree: 5 },
    { id: "countries/us", label: "美国", type: "country", aliases: ["美国","老美"], sources: [], degree: 9 },
    { id: "countries/russia", label: "俄罗斯", type: "country", aliases: ["俄罗斯"], sources: [], degree: 3 },
  ],
  edges: [
    { source: "people/trump", target: "countries/us", relation: "participates-in" },
    { source: "countries/us", target: "countries/russia", relation: "about" },
  ],
};
const search: SearchItem[] = index.nodes.map(n => ({ id: n.id, label: n.label, type: n.type, terms: [n.label, ...n.aliases] }));

describe("data layer", () => {
  it("builds undirected adjacency (in + out)", () => {
    const adj = buildAdjacency(index);
    expect(adj.get("countries/us")!.map(l => l.id).sort()).toEqual(["countries/russia","people/trump"]);
  });
  it("resolves alias exact match (懂王 -> trump)", () => {
    const r = resolveMentions(["懂王"], search, index);
    expect(r[0].id).toBe("people/trump");
  });
  it("on ambiguity prefers higher degree", () => {
    // both contain '美' only us; ensure plain label exact wins and degree tiebreak path works
    const r = resolveMentions(["美国"], search, index);
    expect(r[0].id).toBe("countries/us");
  });
  it("returns empty for no match", () => {
    expect(resolveMentions(["不存在xyz"], search, index)).toEqual([]);
  });
});
```

- [ ] **Step 2: 实现 src/data.ts**
```ts
import type { GraphIndex, GNode, GEdge, SearchItem } from "./types";

export interface AdjLink { id: string; edge: GEdge; dir: "in" | "out"; }
export type Adjacency = Map<string, AdjLink[]>;

export function buildAdjacency(index: GraphIndex): Adjacency {
  const byId = new Map(index.nodes.map(n => [n.id, n]));
  const adj: Adjacency = new Map();
  const push = (from: string, to: string, edge: GEdge, dir: "in" | "out") => {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push({ id: to, edge, dir });
  };
  for (const e of index.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    push(e.source, e.target, e, "out");
    push(e.target, e.source, e, "in");
  }
  const weight = (id: string) => byId.get(id)?.degree ?? 0;
  for (const links of adj.values()) links.sort((a, b) => weight(b.id) - weight(a.id));
  return adj;
}

const norm = (s: string) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, "");

export interface Resolved extends SearchItem { score: number; degree: number; }

/** 解析顺序：别名/标题精确(1000) > 前缀(680) > 包含(560)；并列取 degree 高。返回去重后的实体。 */
export function resolveMentions(mentions: string[], search: SearchItem[], index: GraphIndex): Resolved[] {
  const byId = new Map(index.nodes.map(n => [n.id, n]));
  const q = norm(mentions.join(" "));
  const scored: Resolved[] = [];
  for (const item of search) {
    const terms = [...new Set([item.label, item.id.split("/").pop() ?? "", ...item.terms].filter(Boolean).map(norm))];
    let best = 0;
    for (const term of terms) {
      if (term.length < 2) continue;
      let s = 0;
      if (q === term || mentions.some(m => norm(m) === term)) s = 1000;
      else if (q.includes(term)) s = 820 + Math.min(term.length, 16);
      else if (term.startsWith(q) && q.length >= 2) s = 680;
      else if (term.includes(q) && q.length >= 2) s = 560;
      if (s > best) best = s;
    }
    if (best) scored.push({ ...item, score: best, degree: byId.get(item.id)?.degree ?? 0 });
  }
  scored.sort((a, b) => b.score - a.score || b.degree - a.degree);
  const seen = new Set<string>();
  const out: Resolved[] = [];
  for (const r of scored) { if (seen.has(r.id) || !byId.has(r.id)) continue; seen.add(r.id); out.push(r); }
  return out;
}
```

- [ ] **Step 3: Run** `cd graph-web && npx vitest run tests/data.test.ts` → 绿。
- [ ] **Step 4: 提交** `git add graph-web/src/data.ts graph-web/tests/data.test.ts && git commit -m "feat(graph-web): pure data layer (adjacency + entity resolution)"`

---

## Task 6: 组装引擎 assemble.ts（纯函数：邻域 BFS / 最短路 + 截断）

**Files:** Create `graph-web/src/assemble.ts`; Test `graph-web/tests/assemble.test.ts`

> 移植来源：MVP 的 `buildNeighborhoodResult`/`findShortestPath`/`reconstructPath`/`buildPathResult`/`visibleEdgesFor`。改为接收 `(index, adjacency, plan)` 的纯函数，返回 `AssembleResult`。常量：`MAX_NODES=70`、`MAX_EDGES=180`（与 MVP 一致）。无向遍历；path=最短路（不通则返回空+note）；过滤 `relations` 与 `includeSources`；超 70 截断（BFS 按 degree 高优先——邻接已排序）。

- [ ] **Step 1: 失败测试 tests/assemble.test.ts**
```ts
import { describe, it, expect } from "vitest";
import { assemble } from "../src/assemble";
import { buildAdjacency } from "../src/data";
import type { GraphIndex, QueryPlan } from "../src/types";

const idx: GraphIndex = {
  nodes: [
    { id: "people/a", label: "A", type: "person", aliases: [], sources: [], degree: 3 },
    { id: "events/b", label: "B", type: "event", aliases: [], sources: [], degree: 2 },
    { id: "countries/c", label: "C", type: "country", aliases: [], sources: [], degree: 2 },
    { id: "sources/1", label: "S1", type: "source", aliases: [], sources: [], degree: 1 },
    { id: "takes/t", label: "T", type: "take", aliases: [], sources: [], degree: 1 },
  ],
  edges: [
    { source: "people/a", target: "events/b", relation: "participates-in" },
    { source: "events/b", target: "countries/c", relation: "caused" },
    { source: "people/a", target: "sources/1", relation: "derived-from" },
    { source: "people/a", target: "takes/t", relation: "about" },
  ],
};
const adj = buildAdjacency(idx);
const plan = (p: Partial<QueryPlan>): QueryPlan =>
  ({ entity_mentions: [], mode: "neighborhood", depth: 2, relations: "all", includeSources: false, ...p });

describe("assemble", () => {
  it("neighborhood depth 1 = direct neighbors, sources hidden by default", () => {
    const r = assemble(idx, adj, plan({ entity_mentions: ["people/a"], depth: 1 }));
    const ids = r.nodes.map(n => n.id).sort();
    expect(ids).toContain("people/a");
    expect(ids).toContain("events/b");
    expect(ids).toContain("takes/t");
    expect(ids).not.toContain("sources/1"); // source hidden
  });
  it("neighborhood traverses undirected (reaches C via B at depth 2)", () => {
    const r = assemble(idx, adj, plan({ entity_mentions: ["people/a"], depth: 2 }));
    expect(r.nodes.map(n => n.id)).toContain("countries/c");
  });
  it("includeSources shows source nodes", () => {
    const r = assemble(idx, adj, plan({ entity_mentions: ["people/a"], depth: 1, includeSources: true }));
    expect(r.nodes.map(n => n.id)).toContain("sources/1");
  });
  it("relations filter keeps only listed relations", () => {
    const r = assemble(idx, adj, plan({ entity_mentions: ["people/a"], depth: 2, relations: ["caused"] }));
    expect(r.edges.every(e => e.relation === "caused")).toBe(true);
  });
  it("path mode returns shortest path A->C", () => {
    const r = assemble(idx, adj, plan({ entity_mentions: ["people/a","countries/c"], mode: "path" }));
    expect(r.mode).toBe("path");
    expect(r.nodes.map(n => n.id)).toEqual(["people/a","events/b","countries/c"]);
  });
  it("path mode with unreachable pair returns note + falls back empty path", () => {
    const r = assemble(idx, adj, plan({ entity_mentions: ["takes/t","sources/1"], mode: "path" }));
    expect(r.pathIds.size === 0 || r.note).toBeTruthy();
  });
});
```

- [ ] **Step 2: 实现 src/assemble.ts**
```ts
import type { GraphIndex, GNode, GEdge, QueryPlan, AssembleResult } from "./types";
import type { Adjacency } from "./data";

export const MAX_NODES = 70;
export const MAX_EDGES = 180;

const relAllowed = (rel: string, relations: QueryPlan["relations"]) =>
  relations === "all" || relations.includes(rel);

export function assemble(index: GraphIndex, adj: Adjacency, plan: QueryPlan): AssembleResult {
  const byId = new Map(index.nodes.map(n => [n.id, n]));
  const seeds = plan.entity_mentions.filter(id => byId.has(id));
  if (plan.mode === "path" && seeds.length >= 2) {
    const path = shortestPath(adj, byId, seeds[0], seeds[1], plan);
    if (path) {
      const levels = new Map(path.ids.map((id, i) => [id, i]));
      return { mode: "path", nodes: path.ids.map(id => byId.get(id)!), edges: path.edges,
               levels, pathIds: new Set(path.ids), truncated: false };
    }
    return { ...neighborhood(index, adj, byId, seeds.slice(0, 2), plan),
             note: "未找到 ≤跳数 的连接，回退邻域" };
  }
  return neighborhood(index, adj, byId, seeds.slice(0, 1), plan);
}

function neighborhood(index: GraphIndex, adj: Adjacency, byId: Map<string, GNode>,
                      seedIds: string[], plan: QueryPlan): AssembleResult {
  const visible = new Set(seedIds);
  const levels = new Map(seedIds.map(id => [id, 0]));
  const queue = seedIds.map(id => ({ id, level: 0 }));
  let truncated = false;
  while (queue.length && visible.size < MAX_NODES) {
    const cur = queue.shift()!;
    if (cur.level >= plan.depth) continue;
    for (const link of adj.get(cur.id) ?? []) {
      const node = byId.get(link.id);
      if (!node || (!plan.includeSources && node.type === "source")) continue;
      if (!relAllowed(link.edge.relation, plan.relations)) continue;
      if (!visible.has(link.id)) {
        visible.add(link.id);
        levels.set(link.id, cur.level + 1);
        queue.push({ id: link.id, level: cur.level + 1 });
        if (visible.size >= MAX_NODES) { truncated = true; break; }
      }
    }
  }
  const nodes = [...visible].map(id => byId.get(id)!).filter(Boolean);
  const edges = index.edges.filter(e =>
    visible.has(e.source) && visible.has(e.target) && relAllowed(e.relation, plan.relations) &&
    (plan.includeSources || (byId.get(e.source)?.type !== "source" && byId.get(e.target)?.type !== "source"))
  ).slice(0, MAX_EDGES);
  return { mode: "neighborhood", nodes, edges, levels, pathIds: new Set(), truncated };
}

function shortestPath(adj: Adjacency, byId: Map<string, GNode>, startId: string, endId: string,
                      plan: QueryPlan): { ids: string[]; edges: GEdge[] } | null {
  const maxDepth = plan.includeSources ? 5 : 4;
  const queue: { id: string; depth: number }[] = [{ id: startId, depth: 0 }];
  const prev = new Map<string, { from: string; edge: GEdge }>();
  const seen = new Set([startId]);
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    if (cur.id === endId) break;
    if (cur.depth >= maxDepth) continue;
    for (const link of adj.get(cur.id) ?? []) {
      const node = byId.get(link.id);
      if (!node || (!plan.includeSources && node.type === "source" && link.id !== endId)) continue;
      if (seen.has(link.id)) continue;
      seen.add(link.id);
      prev.set(link.id, { from: cur.id, edge: link.edge });
      if (link.id === endId) { queue.length = 0; break; }
      queue.push({ id: link.id, depth: cur.depth + 1 });
    }
  }
  if (!prev.has(endId) && startId !== endId) return null;
  const ids = [endId]; const edges: GEdge[] = []; let c = endId;
  while (c !== startId) { const s = prev.get(c); if (!s) return null; ids.push(s.from); edges.push(s.edge); c = s.from; }
  ids.reverse(); edges.reverse();
  return { ids, edges };
}
```

- [ ] **Step 3: Run** `cd graph-web && npx vitest run tests/assemble.test.ts` → 绿。
- [ ] **Step 4: 提交** `git add graph-web/src/assemble.ts graph-web/tests/assemble.test.ts && git commit -m "feat(graph-web): pure assemble engine (BFS/path/filter/cap)"`

---

## Task 2 & 8: index.html + Cytoscape 渲染骨架（M2）

**Files:** Create `graph-web/index.html`, `graph-web/src/render.ts`, `graph-web/src/cy-style.ts`

> M2 目标：能从 `data/graph-index.json` 载入并用 **fcose** 渲染 trump depth-2 子图，节点按 type 上**颜色+形状**，隐藏 source。
> index.html 的结构与 CSS **从 MVP 移植**：把 `知识图谱前端-wireframe.html` 的 `<style>...</style>`（设计 token、布局、面板、图例、状态、wiki 模态样式）整段复制到 `index.html`，并把 `<body>` 内 `.app` 结构（header / toolbar 搜索面板 / .layout 三栏 / .states / wiki-modal）一并复制。**只删两处**：① 原 `<svg id="graph">` 换成 `<div id="graph">`（Cytoscape 挂载点，需给它 `width/height:100%`）；② 删掉 `<script>(()=>{...})()</script>` 整段（逻辑改由 `src/main.ts` 模块提供），在 `</body>` 前加 `<script type="module" src="/src/main.ts"></script>`。

- [ ] **Step 1: index.html** — 按上述移植；确认 `#graph` 是 `<div>` 且容器有高度（`.graph-wrap{position:relative}` + `#graph{position:absolute;inset:0}`）。
- [ ] **Step 2: cy-style.ts（Cytoscape stylesheet，单一来源用 relations.ts）**
```ts
import type { Stylesheet } from "cytoscape";
import { TYPE_META } from "./relations";

export function cyStylesheet(): Stylesheet[] {
  const typeSelectors = (Object.keys(TYPE_META) as (keyof typeof TYPE_META)[]).map(t => ({
    selector: `node[type = "${t}"]`,
    style: { "background-color": TYPE_META[t].color, "shape": TYPE_META[t].shape as any },
  }));
  return [
    { selector: "node", style: {
        "width": "mapData(degree, 0, 20, 18, 46)",
        "height": "mapData(degree, 0, 20, 18, 46)",
        "label": "data(label)", "font-size": 11, "color": "#24272b",
        "text-valign": "bottom", "text-margin-y": 4, "text-max-width": "120px",
        "text-wrap": "ellipsis", "text-outline-color": "#fff", "text-outline-width": 2,
      } },
    ...typeSelectors,
    { selector: "node:selected", style: { "border-color": "#111827", "border-width": 3 } },
    { selector: "node.dim", style: { "opacity": 0.28 } },
    { selector: "node.hl", style: { "border-color": "#0a84ff", "border-width": 2 } },
    { selector: "edge", style: {
        "width": 1.4, "line-color": "#c9cdd3", "target-arrow-color": "#a4a8ae",
        "target-arrow-shape": "triangle", "curve-style": "bezier",
        "label": "", "font-size": 9, "color": "#075fb8",
        "text-background-color": "#fff", "text-background-opacity": 0.85, "text-background-padding": "1px",
      } },
    // 默认不显边标签；hover/选中/路径才显（见 render.ts 的 class 切换）
    { selector: "edge.show-label", style: { "label": "data(relCn)" } },
    { selector: "edge.dim", style: { "opacity": 0.16 } },
    { selector: "edge.hl", style: { "line-color": "#0a84ff", "target-arrow-color": "#0a84ff", "width": 2.3 } },
    { selector: "edge.path", style: { "line-color": "#5a6069", "width": 2.2 } },
  ];
}
```

- [ ] **Step 3: render.ts 骨架（init + 渲染一个 AssembleResult）**
```ts
import cytoscape, { type Core } from "cytoscape";
import fcose from "cytoscape-fcose";
import { cyStylesheet } from "./cy-style";
import { relationCn } from "./relations";
import type { AssembleResult } from "./types";

cytoscape.use(fcose);
let cy: Core | null = null;

export function initCy(container: HTMLElement) {
  cy = cytoscape({ container, style: cyStylesheet(), wheelSensitivity: 0.2,
    minZoom: 0.3, maxZoom: 3 });
  return cy;
}

export function renderResult(r: AssembleResult, causal: boolean) {
  if (!cy) throw new Error("cy not initialized");
  cy.elements().remove();
  cy.add(r.nodes.map(n => ({ group: "nodes" as const, data: { ...n } })));
  cy.add(r.edges.map((e, i) => ({ group: "edges" as const,
    data: { id: `e${i}`, source: e.source, target: e.target, relation: e.relation, relCn: relationCn(e.relation) } })));
  // path 边高亮
  if (r.mode === "path") cy.edges().addClass("path");
  runLayout(causal);
}

async function runLayout(causal: boolean) {
  if (!cy) return;
  if (causal) {
    const dagre = (await import("cytoscape-dagre")).default;
    cytoscape.use(dagre as any);
    cy.layout({ name: "dagre", rankDir: "LR", nodeSep: 30, rankSep: 80 } as any).run();
  } else {
    cy.layout({ name: "fcose", quality: "proof", nodeSeparation: 90,
      idealEdgeLength: 90, packComponents: true, animate: false } as any).run();
  }
  cy.fit(undefined, 40);
}
```

- [ ] **Step 4: 临时 main.ts 冒烟（渲染固定 trump depth-2）**
```ts
import { initCy, renderResult } from "./render";
import { buildAdjacency } from "./data";
import { assemble } from "./assemble";
import type { GraphIndex, SearchItem } from "./types";

const graph: GraphIndex = await (await fetch("data/graph-index.json")).json();
const adj = buildAdjacency(graph);
initCy(document.getElementById("graph")!);
renderResult(assemble(graph, adj, {
  entity_mentions: ["people/trump"], mode: "neighborhood", depth: 2, relations: "all", includeSources: false,
}), false);
```

- [ ] **Step 5: 跑 dev 冒烟**

Run: `cd graph-web && npm run build:graph && npx vite`（开发服务器；或 `npm run dev` 待 T10 后用）
打开 vite 打印的 `http://localhost:5173`，预期：屏幕中央出现以"特朗普"为中心、fcose 布局、彩色+形状区分、无 source 的子图，节点不重叠。
> 若 trump id 不是 `people/trump`，先 `npm run verify:trump` 看实际 id。

- [ ] **Step 6: 提交** `git add graph-web/index.html graph-web/src/render.ts graph-web/src/cy-style.ts graph-web/src/main.ts && git commit -m "feat(graph-web): M2 cytoscape render skeleton (fcose + type shape/color)"`

---

## Task 9: 确定性核心 UI（M3）—— 搜索 / 深度 / 详情 / 图例 / 历史

**Files:** Modify `graph-web/src/main.ts`, `graph-web/src/render.ts`; Create `graph-web/src/ui.ts`（详情面板 + 图例 + 历史 DOM）

> 移植来源（从 MVP 提取，改 ES 导出、`fetch` 路径改为 `data/...` 与 `小马哥知识库/wiki/...` 相对）：
> - 详情面板：`renderDetails` / `sourceList` / `wikiLinkForNode`（关系用 `relationCn`，原文用 `node.sources` 查 `sources/N` 节点 label）。
> - wiki 模态：`openWikiModal` / `parseWikiMarkdown` / `renderMarkdownBlocks` / `closeWikiModal`（原样移植）。
> - 图例筛选：`renderLegend` / `handleLegendClick`（`hiddenTypes` 移到模块状态；点图例 toggle 类型显隐 → 重渲染）。
> - 历史：`renderHistory` / `addHistory` / `loadHistory` / `saveHistory`，**localStorage key 统一为 `kg:graphs`**（不要用 MVP 的 `kg:mvp:history`）。
> - 选中聚焦淡出：用 Cytoscape 实现——`cy.on('tap','node', ...)` 选中后，给非邻居加 `.dim`、邻居加 `.hl`、相关边加 `.show-label`+`.hl`；点空白清除。
> - 边标签 hover：`cy.on('mouseover','edge', e=>e.target.addClass('show-label'))` / `mouseout` 移除（path 与选中相关边恒显）。

- [ ] **Step 1: main.ts 完整装配**（事件 → 解析 → 组装 → 渲染 → 历史）
```ts
import { initCy, renderResult, wireGraphInteractions } from "./render";
import { buildAdjacency, resolveMentions } from "./data";
import { assemble } from "./assemble";
import { renderDetails, renderLegend, renderHistory, wireWikiModal, getHiddenTypes } from "./ui";
import type { GraphIndex, SearchItem, QueryPlan, Mode } from "./types";

const $ = (id: string) => document.getElementById(id)!;
const graph: GraphIndex = await (await fetch("data/graph-index.json")).json();
const search: SearchItem[] = await (await fetch("data/search-index.json")).json();
const adj = buildAdjacency(graph);
const byId = new Map(graph.nodes.map(n => [n.id, n]));

initCy($("graph"));
wireGraphInteractions({ onSelect: id => renderDetails(byId.get(id) ?? null, graph, openWiki) });
wireWikiModal();
renderHistory(runSaved);

let depth = 2;
($("depthSegments")).addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest("[data-depth]") as HTMLElement | null;
  if (!b) return;
  depth = Number(b.dataset.depth);
  document.querySelectorAll("#depthSegments [data-depth]").forEach(x => x.classList.toggle("on", x === b));
  if (lastQuery) run(lastQuery, false);
});
($("includeSources")).addEventListener("change", () => lastQuery && run(lastQuery, false));
($("causalMode")).addEventListener("change", () => lastQuery && run(lastQuery, false));
($("searchForm")).addEventListener("submit", e => { e.preventDefault(); run(($("query") as HTMLInputElement).value, true); });

let lastQuery = "";
function run(rawQuery: string, record: boolean) {
  const q = rawQuery.trim(); lastQuery = q;
  if (!q) return;
  // M3：本地解析（M4 会在此之前插入 DeepSeek 意图）
  const matches = resolveMentions(splitMentions(q), search, graph);
  if (!matches.length) { /* 显示"未命中实体" 空态 */ return; }
  const mode: Mode = matches.length >= 2 && /关系|怎么|之间|联系|连/.test(q) ? "path" : "neighborhood";
  const plan: QueryPlan = {
    entity_mentions: matches.slice(0, 2).map(m => m.id), mode, depth,
    relations: "all", includeSources: ($("includeSources") as HTMLInputElement).checked,
  };
  const result = assemble(graph, adj, plan);
  const visible = result.nodes.filter(n => !getHiddenTypes().has(n.type));
  renderResult({ ...result, nodes: visible,
    edges: result.edges.filter(e => visible.some(n=>n.id===e.source) && visible.some(n=>n.id===e.target)) },
    ($("causalMode") as HTMLInputElement).checked);
  renderLegend(result.nodes, () => run(lastQuery, false));
  if (result.nodes[0]) renderDetails(result.nodes[0], graph, openWiki);
  if (record) { addHistorySession(q, result.mode, result.nodes.length); renderHistory(runSaved); }
}
// 辅助：splitMentions / addHistorySession / runSaved / openWiki —— 从 ui.ts 导入或在此实现（见 Step 2）
```
> 提示：`splitMentions(q)` v1 简化为 `[q]`（整句交给 resolveMentions，其内部已对每个 term 评分）。M4 接 DeepSeek 后改为模型抽出的 `entity_mentions`。

- [ ] **Step 2: ui.ts** — 移植 MVP 的 renderDetails/sourceList/renderLegend/renderHistory/openWikiModal 等（按上面"移植来源"清单），导出 `renderDetails / renderLegend / renderHistory / wireWikiModal / getHiddenTypes / addHistorySession / runSaved / openWiki / splitMentions`。关系标签用 `relationCn`，原文项点击调 `openWiki('小马哥知识库/wiki/sources/'+n+'.md', title)`。历史 key=`kg:graphs`。
- [ ] **Step 3: render.ts 增 `wireGraphInteractions`** — 选中淡出/高亮 + 边标签 hover（按上面"选中聚焦"与"边标签 hover"描述）。
- [ ] **Step 4: 手测**：`npx vite` → 搜"懂王"出邻域图；切深度 1/2/3 即时重组；点节点右侧出详情（关系中文 + 原文编号标题，点开 wiki 模态）；点图例隐藏/显示类型；搜"懂王 俄罗斯 关系"走 path；勾"显示原文出处"出现 source 节点。
- [ ] **Step 5: 提交** `git add graph-web/src/main.ts graph-web/src/render.ts graph-web/src/ui.ts && git commit -m "feat(graph-web): M3 deterministic core (search/depth/details/legend/history)"`

---

## Task 10: server.mjs（单进程：托管 + /api/intent）

**Files:** Create `graph-web/server.mjs`

- [ ] **Step 1: server.mjs**
```js
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const DIST = path.join(__dirname, "dist");
const KEY = process.env.DEEPSEEK_API_KEY;
const BASE = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const MODELS = { flash: process.env.DEEPSEEK_MODEL_FLASH || "deepseek-v4-flash",
                 pro: process.env.DEEPSEEK_MODEL_PRO || "deepseek-v4-pro" };

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

const server = http.createServer(async (req, res) => {
  if (req.url === "/api/intent" && req.method === "POST") return handleIntent(req, res);
  // 静态：dist/ 优先，回退 index.html（SPA）
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  let file = path.join(DIST, urlPath === "/" ? "index.html" : urlPath);
  if (!existsSync(file)) file = path.join(DIST, "index.html");
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  } catch { res.writeHead(404); res.end("not found"); }
});

async function handleIntent(req, res) {
  const body = await readBody(req);
  let payload; try { payload = JSON.parse(body); } catch { return json(res, 400, { error: "bad json" }); }
  if (!KEY) return json(res, 503, { error: "no_key", degrade: true }); // 前端据此降级
  const model = MODELS[payload.model === "pro" ? "pro" : "flash"];
  try {
    const r = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model, response_format: { type: "json_object" },
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: String(payload.query || "") }],
      }),
    });
    if (!r.ok) return json(res, 502, { error: `deepseek ${r.status}`, degrade: true });
    const data = await r.json();
    const plan = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    return json(res, 200, { plan });
  } catch (e) { return json(res, 502, { error: String(e), degrade: true }); }
}

const SYSTEM_PROMPT = `你是知识图谱查询解析器，只输出 JSON 查询计划。
领域：马永谙时政历史知识库，实体 6 类（人物/组织/国家/事件/观点/原文）。
输出字段：entity_mentions(string[] 用户原词)、mode("neighborhood"|"path")、depth(1-3,默认2)、relations("all"或["caused","supports","participates-in",...])、includeSources(bool,默认false)。
关系动词：mentions/participates-in/about/opposes/caused/part-of/derived-from/supports/contradicts。
俗称→规范示例：懂王/川建国/川总/前班长→特朗普；漂亮国/山姆大叔/老美/米国→美国；我国/东方大国/咱们国家→中国。
规则：两实体且问"关系/怎么连/之间/影响"→mode=path；"相关/周边"→neighborhood；"因果/导致/推动"→relations 收窄到 caused/supports/participates-in。
只抽用户原词，不要编造不存在的实体。只输出 JSON。`;

function readBody(req){return new Promise(r=>{let d="";req.on("data",c=>d+=c);req.on("end",()=>r(d));});}
function json(res, code, obj){res.writeHead(code,{"content-type":"application/json"});res.end(JSON.stringify(obj));}

server.listen(PORT, () => console.log(`server on http://localhost:${PORT}`));
```
> dev 模式（`node server.mjs --dev`）：M4 v1 先用 `npm run start`（vite build + server）跑通；纯 dev-middleware 热更新可后续再加，不阻塞 v1。`.env` 由 Node ≥20.6 的 `--env-file` 或在 `start` 脚本里 `node --env-file=.env server.mjs`。**更新 package.json 的 start：`"start": "vite build && node --env-file=.env server.mjs"`，dev 用 `"dev": "node --env-file=.env --watch server.mjs"` 配合单独的 `vite`**。

- [ ] **Step 2: 手测**：填好 `.env`（用**新轮换**的 key），`cd graph-web && npm run start` → 打开 `http://localhost:4173`，页面加载、静态资源正常。
- [ ] **Step 3: 提交** `git add graph-web/server.mjs graph-web/package.json && git commit -m "feat(graph-web): single-process server (static + /api/intent proxy)"`

---

## Task 11: intent.ts（DeepSeek 调用 + 降级 + 缓存）(M4)

**Files:** Create `graph-web/src/intent.ts`; Test `graph-web/tests/intent.test.ts`; Modify `graph-web/src/main.ts`

> 降级 plan 必须与正常 plan **同构**，下游 assemble 不分支。缓存 key=`kg:plan:<归一化query+model>`。

- [ ] **Step 1: 失败测试 tests/intent.test.ts**
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolvePlan, degradePlan } from "../src/intent";

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("intent", () => {
  it("returns plan from /api/intent on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ plan: { entity_mentions:["懂王"], mode:"neighborhood", depth:2, relations:"all", includeSources:false } }), { status: 200 })));
    const plan = await resolvePlan("懂王相关", "flash");
    expect(plan.mode).toBe("neighborhood");
  });
  it("degrades to local plan on failure (isomorphic shape)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 502 })));
    const plan = await resolvePlan("懂王", "flash");
    expect(plan).toEqual(degradePlan("懂王"));
    expect(plan.entity_mentions).toEqual(["懂王"]);
  });
  it("caches plan, no second request", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ plan: degradePlan("x") }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await resolvePlan("同一查询", "flash");
    await resolvePlan("同一查询", "flash");
    expect(f).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 实现 src/intent.ts**
```ts
import type { QueryPlan } from "./types";

export function degradePlan(query: string): QueryPlan {
  return { entity_mentions: [query.trim()], mode: "neighborhood", depth: 2, relations: "all", includeSources: false };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");

export async function resolvePlan(query: string, model: "flash" | "pro"): Promise<QueryPlan> {
  const key = `kg:plan:${norm(query)}|${model}`;
  const cached = localStorage.getItem(key);
  if (cached) { try { return JSON.parse(cached); } catch {} }
  let plan: QueryPlan;
  try {
    const r = await fetch("/api/intent", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ query, model }) });
    if (!r.ok) plan = degradePlan(query);
    else { const data = await r.json(); plan = data.plan && data.plan.entity_mentions ? normalizePlan(data.plan, query) : degradePlan(query); }
  } catch { plan = degradePlan(query); }
  localStorage.setItem(key, JSON.stringify(plan));
  return plan;
}

function normalizePlan(p: any, query: string): QueryPlan {
  return {
    entity_mentions: Array.isArray(p.entity_mentions) && p.entity_mentions.length ? p.entity_mentions : [query.trim()],
    mode: p.mode === "path" ? "path" : "neighborhood",
    depth: [1,2,3].includes(p.depth) ? p.depth : 2,
    relations: Array.isArray(p.relations) ? p.relations : "all",
    includeSources: Boolean(p.includeSources),
  };
}
```

- [ ] **Step 3: 接进 main.ts** — `run()` 改为：先 `const plan0 = await resolvePlan(q, model)`；用 `resolveMentions(plan0.entity_mentions, search, graph)` 得 id；用 `plan0.mode/depth/relations` 覆盖本地默认（UI 的深度/出处仍可即时覆盖：深度/出处变更走"不重调模型"路径，直接用上次 mentions 重组）。顶栏意图回显展示解析到的实体 + 模式。
- [ ] **Step 4: Run** `cd graph-web && npx vitest run tests/intent.test.ts` → 绿。
- [ ] **Step 5: 提交** `git add graph-web/src/intent.ts graph-web/tests/intent.test.ts graph-web/src/main.ts && git commit -m "feat(graph-web): M4 DeepSeek intent layer with local degrade + cache"`

---

## Task 12: 打磨（M5）

**Files:** Modify `graph-web/src/render.ts`, `graph-web/src/ui.ts`, `graph-web/index.html`(CSS)

- [ ] **Step 1: dagre 因果开关** — 已在 `runLayout(causal)` 接通（T2 Step3）；确认勾选 `causalMode` 时走 dagre、取消回 fcose。手测：勾选后图变成左→右分层。
- [ ] **Step 2: 根节点强调** — 渲染后给 seed 节点（`levels.get(id)===0`）加 `.hl` 或更大 border；`renderResult` 接收 seedIds 并 `cy.$id(seed).addClass('seed')`，cy-style 加 `node.seed{border-width:3,border-color:#111}`。
- [ ] **Step 3: 触控目标 ≥44px** — index.html CSS：`@media (pointer: coarse)` 下 `.legend button{height:44px}`、`.history-more{width:44px;height:44px}`、`.seg button{height:44px}`。
- [ ] **Step 4: 边标签密度** — 确认默认无边标签，仅 hover/选中相邻/path 显（T9 Step3 已实现）；手测枢纽搜索不再满屏字。
- [ ] **Step 5: 提交** `git add -A graph-web/src graph-web/index.html && git commit -m "feat(graph-web): M5 polish (dagre toggle, seed emphasis, touch targets)"`

---

## Task 13: 加分项（M6）

**Files:** Modify `graph-web/src/main.ts`, `graph-web/src/ui.ts`, `graph-web/index.html`

- [ ] **Step 1: 关系类型筛选** — 在图例区加一组关系开关（caused/supports/contradicts/...），勾选改 `plan.relations`，重跑 `run(lastQuery,false)`（assemble 已支持 relations 过滤）。
- [ ] **Step 2: 观点高亮** — 加一个"高亮观点"按钮：`cy.nodes('[type="take"]').addClass('hl')`，再点取消。
- [ ] **Step 3: path 最短路径** — 已在 assemble 实现；确认两实体 + "关系/怎么连"触发 path 模式，路径边加粗（`.path`）。
- [ ] **Step 4: 提交** `git add -A graph-web && git commit -m "feat(graph-web): M6 extras (relation filter, take highlight, path mode)"`

---

## 验收（全部任务后）

- [ ] `cd graph-web && npm test` 全绿（build-graph / data / assemble / relations / intent）。
- [ ] `npm run start`（填好 .env）→ `http://localhost:4173`：
  - 搜"懂王/美联储/广场协议"出**枢纽不重叠**的图（fcose）；深度 1/2/3、因果开关、显示出处**即时重组**。
  - 点节点 → 详情含关系（中文）+ 原文编号+标题，点开 wiki 只读模态。
  - 搜"懂王 俄罗斯 关系" → path 模式两实体连线。
  - **拔掉 .env 的 key 重启** → 搜索仍可用（降级到本地解析），不报死。
  - 色盲检查：类型靠形状也能区分（人物=圆/国家=六边/事件=方/观点=菱/组织=tag）。
- [ ] 安全：`git status` 确认 `.env` 未被追踪；bundle 内 grep 不到 key（`grep -r "sk-" graph-web/dist || echo clean`）。

---

## Self-Review（计划作者自检结果）

- **Spec 覆盖**：M2(T2/T8) · M3(T4/T6/T9) · M4(T10/T11) · M5(T12) · M6(T13) · 数据测试(T0) · 脚手架(T1) · 类型/单源(T3)。设计 §6 DeepSeek prompt → T10 SYSTEM_PROMPT；§7 清晰图谱(形状/边标签/上限70/fcose-dagre) → T2/T9/T12；§13 测试策略 → T0/T6/T11；§14 色盲/边标签/dagre → T3/T9/T12。无遗漏。
- **占位符扫描**：无 TBD/TODO；移植类步骤均给出**确切源文件 + 函数名 + 接口签名 + 改动点**，新代码全量给出。
- **类型一致**：`QueryPlan`/`AssembleResult`/`GNode` 跨任务一致；`buildAdjacency`/`assemble`/`resolveMentions`/`resolvePlan`/`degradePlan` 签名前后一致；relations 单源 `relations.ts` 被 cy-style/ui/render 共用。
- **已知顺序依赖**：T1 先于 T0（vitest 需先装）；T3 先于 T4/T6（类型）；T2 先于 T9（cy 实例）；T10 先于 T11（/api/intent）。已在各任务标注。
