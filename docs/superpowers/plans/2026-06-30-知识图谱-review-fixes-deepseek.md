# 知识图谱 Review 修复与 DeepSeek 配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the review blockers, clean low-risk dead code/config, add missing safety tests, and configure DeepSeek locally without committing secrets.

**Architecture:** Keep `graph-web` as a Vite + TypeScript + Cytoscape app with a tiny Node HTTP server. DeepSeek remains an intent parser only; all graph nodes and edges continue to come from generated local JSON. Server code is refactored just enough to be testable without starting a real long-lived listener.

**Tech Stack:** Node 20.12+, npm, Vite 5, Vitest 2, TypeScript 5, Cytoscape, plain DOM APIs, Node `http` server.

---

## File Map

- Modify `graph-web/package.json`: remove dead dependencies, add `engines.node`, keep scripts.
- Modify `graph-web/package-lock.json`: mechanical npm lockfile update after dependency removal.
- Modify `graph-web/vite.config.ts`: remove React plugin, allow `.test.mjs` server tests.
- Modify `graph-web/tsconfig.json`: remove unused JSX setting.
- Modify `graph-web/src/main.ts`: route manual override flags through a small testable helper.
- Create `graph-web/src/query-overrides.ts`: pure helper for per-query override reset.
- Create `graph-web/tests/query-overrides.test.ts`: unit tests for override reset behavior.
- Modify `graph-web/src/ui.ts`: remove unused `splitMentions`.
- Modify `graph-web/index.html`: remove stale MVP/local fallback wording.
- Modify `graph-web/tests/ui.test.ts`: assert static HTML has no stale MVP fallback copy.
- Modify `graph-web/tests/assemble.test.ts`: add node and edge truncation coverage.
- Modify `graph-web/server.mjs`: export a testable `createGraphServer`, keep CLI listen behavior.
- Create `graph-web/tests/server.test.mjs`: test SPA fallback, traversal guard, and no-key `/api/intent` degradation.
- Modify local-only `graph-web/.env`: write DeepSeek config from a shell environment variable; never stage it.

---

### Task 1: Clean Dependencies And Build Config

**Files:**
- Modify: `graph-web/package.json`
- Modify: `graph-web/package-lock.json`
- Modify: `graph-web/vite.config.ts`
- Modify: `graph-web/tsconfig.json`

- [ ] **Step 1: Confirm dead dependencies are present**

Run:

```powershell
Set-Location graph-web
npm ls @vitejs/plugin-react fuse.js
```

Expected now: both packages appear in the dependency tree.

- [ ] **Step 2: Edit package.json**

Replace the dependency sections in `graph-web/package.json` with:

```json
  "engines": {
    "node": ">=20.12.0"
  },
  "dependencies": {
    "cytoscape": "^3.30.0",
    "cytoscape-fcose": "^2.2.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "cytoscape-dagre": "^2.5.0",
    "dagre": "^0.8.5",
    "jsdom": "^25.0.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
```

Keep the existing `scripts`, `name`, `private`, `version`, `type`, and `description`.

- [ ] **Step 3: Edit vite.config.ts**

Remove this import:

```ts
import react from "@vitejs/plugin-react";
```

Change the `plugins` line to:

```ts
  plugins: [wikiMarkdownPlugin()],
```

Change the Vitest include line to allow server `.mjs` tests:

```ts
    include: ["tests/**/*.test.ts", "tests/**/*.test.mjs"],
```

- [ ] **Step 4: Edit tsconfig.json**

Remove the line:

```json
    "jsx": "react-jsx"
```

Ensure the previous property still has valid JSON commas. The tail of `compilerOptions` should end like:

```json
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
```

- [ ] **Step 5: Regenerate lockfile**

Run:

```powershell
Set-Location graph-web
npm install --package-lock-only
```

Expected: command exits 0 and updates `package-lock.json`.

- [ ] **Step 6: Verify dependencies are gone**

Run:

```powershell
Set-Location graph-web
npm ls @vitejs/plugin-react fuse.js
```

Expected: npm reports the packages are not installed or returns an empty tree for those names.

- [ ] **Step 7: Commit**

Run:

```powershell
git add graph-web/package.json graph-web/package-lock.json graph-web/vite.config.ts graph-web/tsconfig.json
git commit -m "chore(graph-web): remove dead dependencies"
```

Expected: commit succeeds and only the four listed files are staged.

---

### Task 2: Add Query Override Reset Helper

**Files:**
- Create: `graph-web/src/query-overrides.ts`
- Create: `graph-web/tests/query-overrides.test.ts`
- Modify: `graph-web/src/main.ts`

- [ ] **Step 1: Write the failing helper test**

Create `graph-web/tests/query-overrides.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createQueryOverrideState } from "../src/query-overrides";

describe("query override state", () => {
  it("resets manual depth and source overrides for a new user query", () => {
    const state = createQueryOverrideState();
    state.markDepthOverridden();
    state.markSourcesOverridden();

    state.resetForRun(true);

    expect(state.depthOverridden).toBe(false);
    expect(state.sourcesOverridden).toBe(false);
  });

  it("keeps manual overrides for internal reruns", () => {
    const state = createQueryOverrideState();
    state.markDepthOverridden();
    state.markSourcesOverridden();

    state.resetForRun(false);

    expect(state.depthOverridden).toBe(true);
    expect(state.sourcesOverridden).toBe(true);
  });
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```powershell
Set-Location graph-web
npm test -- tests/query-overrides.test.ts
```

Expected: FAIL because `../src/query-overrides` does not exist.

- [ ] **Step 3: Implement the helper**

Create `graph-web/src/query-overrides.ts`:

```ts
export type QueryOverrideState = {
  readonly depthOverridden: boolean;
  readonly sourcesOverridden: boolean;
  markDepthOverridden: () => void;
  markSourcesOverridden: () => void;
  resetForRun: (recordHistory: boolean) => void;
};

export function createQueryOverrideState(): QueryOverrideState {
  let depthOverridden = false;
  let sourcesOverridden = false;

  return {
    get depthOverridden() {
      return depthOverridden;
    },
    get sourcesOverridden() {
      return sourcesOverridden;
    },
    markDepthOverridden() {
      depthOverridden = true;
    },
    markSourcesOverridden() {
      sourcesOverridden = true;
    },
    resetForRun(recordHistory: boolean) {
      if (!recordHistory) return;
      depthOverridden = false;
      sourcesOverridden = false;
    },
  };
}
```

- [ ] **Step 4: Wire helper into main.ts**

Add import:

```ts
import { createQueryOverrideState } from "./query-overrides";
```

Replace:

```ts
  let depthOverridden = false;
  let sourcesOverridden = false;
```

with:

```ts
  const queryOverrides = createQueryOverrideState();
```

Replace depth click mutation:

```ts
    depthOverridden = true;
```

with:

```ts
    queryOverrides.markDepthOverridden();
```

Replace include source mutation:

```ts
    sourcesOverridden = true;
```

with:

```ts
    queryOverrides.markSourcesOverridden();
```

At the top of `runQuery`, immediately after `const trimmed = query.trim();`, add:

```ts
    queryOverrides.resetForRun(recordHistory);
```

Replace:

```ts
    if (!depthOverridden) setDepth(depthInput, depthSegments, String(modelPlan.depth));
    if (!sourcesOverridden) includeSources.checked = modelPlan.includeSources;
```

with:

```ts
    if (!queryOverrides.depthOverridden) setDepth(depthInput, depthSegments, String(modelPlan.depth));
    if (!queryOverrides.sourcesOverridden) includeSources.checked = modelPlan.includeSources;
```

- [ ] **Step 5: Verify helper tests pass**

Run:

```powershell
Set-Location graph-web
npm test -- tests/query-overrides.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add graph-web/src/query-overrides.ts graph-web/tests/query-overrides.test.ts graph-web/src/main.ts
git commit -m "fix(graph-web): reset query overrides for new searches"
```

Expected: commit succeeds.

---

### Task 3: Remove Stale Copy And Dead UI Code

**Files:**
- Modify: `graph-web/index.html`
- Modify: `graph-web/src/ui.ts`
- Modify: `graph-web/tests/ui.test.ts`

- [ ] **Step 1: Add static HTML copy test**

In `graph-web/tests/ui.test.ts`, add this import:

```ts
import { readFile } from "node:fs/promises";
```

Add this test inside `describe("intent line rendering", () => { ... })`:

```ts
  it("static html does not ship stale MVP fallback copy", async () => {
    const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

    expect(html).not.toContain("MVP 本地回退");
    expect(html).not.toContain("模型选择位保留");
    expect(html).not.toContain("知识图谱 MVP");
  });
```

- [ ] **Step 2: Run UI tests to verify the new assertion fails**

Run:

```powershell
Set-Location graph-web
npm test -- tests/ui.test.ts
```

Expected: FAIL because `index.html` still contains stale MVP copy.

- [ ] **Step 3: Update index.html copy**

Make these text-only replacements in `graph-web/index.html`:

```html
<title>小马哥知识库 · 知识图谱</title>
```

Replace stale explanatory copy mentioning model selection being reserved for later with a current copy that does not include `MVP`:

```html
“生成图谱”会结合文本、深度、模型与出处设置；DeepSeek 只解析查询意图，图谱内容仍来自本地 wiki。
```

Do not change element IDs or form controls.

- [ ] **Step 4: Remove dead splitMentions**

Delete this exported function from `graph-web/src/ui.ts`:

```ts
export function splitMentions(q: string): string[] {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/[\s,，、]+/).filter(Boolean);
  return [...new Set([trimmed, ...parts])];
}
```

- [ ] **Step 5: Verify UI tests pass**

Run:

```powershell
Set-Location graph-web
npm test -- tests/ui.test.ts
```

Expected: PASS.

- [ ] **Step 6: Verify dead code is gone**

Run:

```powershell
rg -n "splitMentions|MVP 本地回退|模型选择位保留|知识图谱 MVP" graph-web
```

Expected: no matches.

- [ ] **Step 7: Commit**

Run:

```powershell
git add graph-web/index.html graph-web/src/ui.ts graph-web/tests/ui.test.ts
git commit -m "fix(graph-web): remove stale mvp copy"
```

Expected: commit succeeds.

---

### Task 4: Add Assemble Truncation Coverage

**Files:**
- Modify: `graph-web/tests/assemble.test.ts`

- [ ] **Step 1: Add truncation tests**

Update the import in `graph-web/tests/assemble.test.ts`:

```ts
import { assemble, MAX_EDGES, MAX_NODES } from "../src/assemble";
```

Append these tests inside `describe("assemble", () => { ... })`:

```ts
  it("marks neighborhood results truncated when MAX_NODES is reached", () => {
    const nodes = [
      { id: "people/root", label: "Root", type: "person" as const, aliases: [], sources: [], degree: MAX_NODES + 5 },
      ...Array.from({ length: MAX_NODES + 5 }, (_, i) => ({
        id: `events/n${i}`,
        label: `N${i}`,
        type: "event" as const,
        aliases: [],
        sources: [],
        degree: MAX_NODES + 5 - i,
      })),
    ];
    const graph: GraphIndex = {
      nodes,
      edges: nodes.slice(1).map((node) => ({ source: "people/root", target: node.id, relation: "mentions" })),
    };

    const result = assemble(graph, buildAdjacency(graph), plan({ entity_mentions: ["people/root"], depth: 1 }));

    expect(result.nodes).toHaveLength(MAX_NODES);
    expect(result.truncated).toBe(true);
    expect(result.nodes[1].id).toBe("events/n0");
  });

  it("marks neighborhood results truncated when MAX_EDGES is reached", () => {
    const nodeIds = Array.from({ length: 20 }, (_, i) => `events/e${i}`);
    const graph: GraphIndex = {
      nodes: [
        { id: "people/root", label: "Root", type: "person", aliases: [], sources: [], degree: nodeIds.length },
        ...nodeIds.map((id) => ({ id, label: id, type: "event" as const, aliases: [], sources: [], degree: 1 })),
      ],
      edges: [
        ...nodeIds.map((id) => ({ source: "people/root", target: id, relation: "mentions" })),
        ...Array.from({ length: MAX_EDGES + 5 }, (_, i) => ({
          source: nodeIds[i % nodeIds.length],
          target: nodeIds[(i + 1) % nodeIds.length],
          relation: "supports",
        })),
      ],
    };

    const result = assemble(graph, buildAdjacency(graph), plan({ entity_mentions: ["people/root"], depth: 1 }));

    expect(result.edges).toHaveLength(MAX_EDGES);
    expect(result.truncated).toBe(true);
  });
```

- [ ] **Step 2: Run assemble tests**

Run:

```powershell
Set-Location graph-web
npm test -- tests/assemble.test.ts
```

Expected: PASS if current truncation behavior is already correct. If the edge truncation test fails because visible edges are fewer than expected, adjust only the test graph density, not production code.

- [ ] **Step 3: Commit**

Run:

```powershell
git add graph-web/tests/assemble.test.ts
git commit -m "test(graph-web): cover graph truncation limits"
```

Expected: commit succeeds.

---

### Task 5: Make Server Testable And Add Server Tests

**Files:**
- Modify: `graph-web/server.mjs`
- Create: `graph-web/tests/server.test.mjs`

- [ ] **Step 1: Refactor server export without changing runtime behavior**

In `graph-web/server.mjs`, change the bottom server creation to export a factory. Replace:

```js
const server = createServer(async (request, response) => {
  const url = parseRequestUrl(request, response);
  if (!url) {
    return;
  }

  try {
    if (url.pathname === "/api/intent") {
      await handleIntent(request, response);
      return;
    }

    await serveStatic(request, response, url);
  } catch {
    if (!response.headersSent) {
      sendPlain(request, response, 500, "Internal server error");
    } else {
      response.destroy();
    }
  }
});

server.listen(PORT, () => {
  console.log(`graph-web server listening on http://localhost:${PORT}`);
});
```

with:

```js
export function createGraphServer(options = {}) {
  const config = {
    distDir: options.distDir ? path.resolve(options.distDir) : DIST_DIR,
    env: options.env || process.env,
    fetchImpl: options.fetchImpl || fetch,
  };
  config.indexHtml = path.join(config.distDir, "index.html");

  return createServer(async (request, response) => {
    const url = parseRequestUrl(request, response);
    if (!url) {
      return;
    }

    try {
      if (url.pathname === "/api/intent") {
        await handleIntent(request, response, config);
        return;
      }

      await serveStatic(request, response, url, config);
    } catch {
      if (!response.headersSent) {
        sendPlain(request, response, 500, "Internal server error");
      } else {
        response.destroy();
      }
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createGraphServer();
  server.listen(PORT, () => {
    console.log(`graph-web server listening on http://localhost:${PORT}`);
  });
}
```

Then update function signatures and internals:

```js
async function handleIntent(request, response, config = { env: process.env, fetchImpl: fetch }) {
```

Replace `process.env.DEEPSEEK_API_KEY` with `config.env.DEEPSEEK_API_KEY`.

Replace the upstream `fetch(` call with `config.fetchImpl(`.

Replace model, base URL, and timeout reads inside `handleIntent` with config-aware values:

```js
  const model = payload.model === "pro"
    ? (config.env.DEEPSEEK_MODEL_PRO || PRO_MODEL)
    : (config.env.DEEPSEEK_MODEL_FLASH || FLASH_MODEL);
  const baseUrl = config.env.DEEPSEEK_BASE_URL || BASE_URL;
  const timeoutMs = Number(config.env.DEEPSEEK_TIMEOUT_MS || 30000);
```

Then use them in the upstream call:

```js
    const upstream = await config.fetchImpl(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
```

and:

```js
      signal: AbortSignal.timeout(timeoutMs),
```

Change `serveStatic` signature:

```js
async function serveStatic(request, response, url, config = { distDir: DIST_DIR, indexHtml: INDEX_HTML }) {
```

Inside `serveStatic`, replace `DIST_DIR` with `config.distDir` and `INDEX_HTML` with `config.indexHtml`.

Change `isUnderDist` to accept a root:

```js
function isUnderDist(filePath, distDir = DIST_DIR) {
  const relative = path.relative(distDir, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
```

When `serveStatic` calls `isUnderDist`, pass `config.distDir`.

- [ ] **Step 2: Add server tests**

Create `graph-web/tests/server.test.mjs`:

```js
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGraphServer } from "../server.mjs";

let server;
let baseUrl;
let distDir;

async function startTestServer(options = {}) {
  server = createGraphServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
}

describe("graph-web server", () => {
  beforeEach(async () => {
    distDir = await mkdtemp(path.join(tmpdir(), "graph-web-server-"));
    await writeFile(path.join(distDir, "index.html"), "<!doctype html><title>Graph Web</title>", "utf8");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (server) {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    server = undefined;
    baseUrl = undefined;
  });

  it("serves index.html for SPA routes without file extensions", async () => {
    await startTestServer({ distDir, env: {}, fetchImpl: vi.fn() });

    const response = await fetch(`${baseUrl}/wiki/sources/80`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Graph Web");
  });

  it("blocks path traversal outside dist", async () => {
    await startTestServer({ distDir, env: {}, fetchImpl: vi.fn() });

    const response = await fetch(`${baseUrl}/..%2Fpackage.json`);

    expect(response.status).toBe(403);
  });

  it("returns degradable json for intent when no DeepSeek key is configured", async () => {
    const fetchImpl = vi.fn();
    await startTestServer({ distDir, env: {}, fetchImpl });

    const response = await fetch(`${baseUrl}/api/intent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "美国", model: "flash" }),
    });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: "no_key", degrade: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run server tests**

Run:

```powershell
Set-Location graph-web
npm test -- tests/server.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Run type check for server export side effects**

Run:

```powershell
Set-Location graph-web
npx tsc --noEmit
```

Expected: PASS. The `.mjs` test is not part of TypeScript checking.

- [ ] **Step 5: Commit**

Run:

```powershell
git add graph-web/server.mjs graph-web/tests/server.test.mjs
git commit -m "test(graph-web): cover server fallback paths"
```

Expected: commit succeeds.

---

### Task 6: DeepSeek Local Config And Prompt Tightening

**Files:**
- Modify: `graph-web/server.mjs`
- Modify local only: `graph-web/.env`

- [ ] **Step 1: Tighten the server prompt**

Replace `SYSTEM_PROMPT` in `graph-web/server.mjs` with this UTF-8 string:

```js
const SYSTEM_PROMPT = `你是“小马哥知识库”知识图谱的查询意图解析器。你只能输出 JSON，不输出 Markdown，不解释。

你不生成图谱内容。节点、边、文章内容只能来自本地 wiki 索引。你的任务只是把用户输入转成查询计划。

实体类型：person 人物、org 组织、country 国家、event 事件、take 观点、source 原文。
关系枚举：mentions、participates-in、about、opposes、caused、part-of、derived-from、supports、contradicts。

输出 JSON 结构：
{
  "entity_mentions": ["用户原文中的实体或别名"],
  "mode": "neighborhood" 或 "path",
  "depth": 1 或 2,
  "relations": "all" 或 ["关系枚举值"],
  "includeSources": true 或 false
}

规则：
1. entity_mentions 只抽取用户输入中出现的词，不编造新实体 ID。
2. 两个实体并询问“关系、怎么连、之间、影响、关联、路径”时，mode 使用 "path"。
3. 单实体或“相关、周边、展开、图谱”时，mode 使用 "neighborhood"。
4. 用户提到“因果、导致、推动、造成、支撑、参与”时，relations 优先收窄到 caused、supports、participates-in。
5. 用户明确要求文章、原文、出处、来源时，includeSources 使用 true；否则 false。
6. depth 默认 2；只允许 1 或 2。
7. 常见别名按原词抽取：懂王、川普、特朗普、前总统、前班长可指向同一人物；漂亮国、山姆大叔、老美、美国可指向同一国家；我国、东方大国、咱们国家、中国可指向同一国家。仍然输出用户原词，不输出规范化 ID。
8. 只输出合法 JSON 对象。`;
```

- [ ] **Step 2: Run prompt-related intent tests**

Run:

```powershell
Set-Location graph-web
npm test -- tests/intent.test.ts
```

Expected: PASS. Existing tests mock `/api/intent`, so this validates frontend normalization remains compatible.

- [ ] **Step 3: Create or update local .env without writing secrets to git**

In a PowerShell session, first set the key as an environment variable outside git history:

```powershell
$secureKey = Read-Host -AsSecureString "DeepSeek API key"
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
  $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  @"
DEEPSEEK_API_KEY=$plainKey
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL_FLASH=deepseek-v4-flash
DEEPSEEK_MODEL_PRO=deepseek-v4-pro
PORT=4173
"@ | Set-Content -Path graph-web\.env -Encoding utf8
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Variable secureKey, plainKey, bstr -ErrorAction SilentlyContinue
}
```

Do not paste the key into any tracked file. If the current key has been exposed in chat, rotate it after this implementation.

- [ ] **Step 4: Verify .env is ignored**

Run:

```powershell
git check-ignore -v graph-web/.env
git status --short graph-web/.env
```

Expected: first command prints the `.gitignore` rule; second command prints nothing.

- [ ] **Step 5: Commit prompt change only**

Run:

```powershell
git add graph-web/server.mjs
git commit -m "fix(graph-web): tighten deepseek intent prompt"
```

Expected: commit includes only `graph-web/server.mjs`. It must not include `.env`.

---

### Task 7: Full Verification And Secret Scan

**Files:**
- No code changes expected unless verification exposes a defect.

- [ ] **Step 1: Run focused search for removed dead config**

Run:

```powershell
rg -n "React|@vitejs/plugin-react|fuse.js|splitMentions" graph-web/src graph-web/package.json graph-web/vite.config.ts graph-web/tsconfig.json
```

Expected: no matches.

- [ ] **Step 2: Run full tests**

Run:

```powershell
Set-Location graph-web
npm test
```

Expected: all Vitest files pass.

- [ ] **Step 3: Run type check**

Run:

```powershell
Set-Location graph-web
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Run production build**

Run:

```powershell
Set-Location graph-web
npm run build
```

Expected: build exits 0. Vite chunk-size warnings are acceptable if no errors occur.

- [ ] **Step 5: Run optional real wiki smoke**

Run:

```powershell
Set-Location graph-web
npm run verify:trump
```

Expected: command exits 0 and does not modify tracked files.

- [ ] **Step 6: Run diff and secret checks**

Run:

```powershell
Set-Location ..
git diff --check
rg -n "sk-[A-Za-z0-9]{12,}" .
git status --short
```

Expected:

- `git diff --check` exits 0.
- `rg` finds no real key. A placeholder without real key material is acceptable only in `.env.example`.
- `git status --short` does not include `graph-web/.env`, `graph-web/dist/`, or generated public data.

- [ ] **Step 7: Commit verification fixes if needed**

If verification required a small fix, commit it:

```powershell
git add <only-files-fixed-by-verification>
git commit -m "fix(graph-web): address verification findings"
```

Expected: no commit is made if all verification passed without changes.

---

## Completion Criteria

- Important review items are fixed.
- Low-risk Minor items listed in the spec are fixed.
- DeepSeek local config exists only in ignored `.env`.
- Server and assemble test gaps have coverage.
- No raw/wiki content is changed.
- No real API key is tracked or printed in final output.
- `npm test`, `npx tsc --noEmit`, `npm run build`, `git diff --check`, and secret scan pass.
