#!/usr/bin/env node
/**
 * build-graph.mjs — 把 小马哥知识库/wiki 编译成图谱索引（零依赖）
 *
 * 产出（写到 ../public/data/）：
 *   - graph-index.json   全量 节点 + 边（邻接数据，运行期做 BFS 用）
 *   - search-index.json  搜索条目 {id,label,type,terms}（实体解析/降级搜索用）
 *   - build-report.json  统计 + 悬空链接清单
 *
 * 边的来源（两路，去重合并）：
 *   1) 每页 `## 关系` 块：`- <relation> [[target]] ...`
 *   2) event frontmatter 的 `actors: ["[[people/x]]", ...]` → (actor → event, participates-in)
 *      （因为人物页常是旧编译，未必回链到每个事件，actors 补齐反向边）
 *
 * 用法：
 *   node scripts/build-graph.mjs                 # 默认 wiki 路径
 *   node scripts/build-graph.mjs <wikiDir>       # 指定 wiki 路径
 *   node scripts/build-graph.mjs --verify        # 构建后打印 trump 邻域，肉眼对比精修图
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- 参数 ----------
const args = process.argv.slice(2);
const VERIFY = args.includes('--verify');
const positionalArgs = [];
let outArg = null;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--out') {
    outArg = args[i + 1] ?? null;
    i++;
    continue;
  }
  if (arg === '--verify') continue;
  if (!arg.startsWith('--')) positionalArgs.push(arg);
}
const wikiArg = positionalArgs[0];
const WIKI_DIR = wikiArg
  ? path.resolve(wikiArg)
  : path.resolve(__dirname, '../../小马哥知识库/wiki');
const OUT_DIR = outArg ? path.resolve(outArg) : path.resolve(__dirname, '../public/data');

// ---------- 常量 ----------
const TYPE_BY_PREFIX = {
  people: 'person',
  orgs: 'org',
  countries: 'country',
  events: 'event',
  takes: 'take',
  sources: 'source',
};
const RELATION_VERBS = new Set([
  'mentions', 'participates-in', 'about', 'opposes', 'caused',
  'part-of', 'derived-from', 'supports', 'contradicts',
]);

// ---------- 工具 ----------
function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'graphs') continue;
      walk(path.join(dir, entry.name), acc);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

function idFromPath(full) {
  return path.relative(WIKI_DIR, full).replace(/\\/g, '/').replace(/\.md$/, '');
}

function unquote(s) {
  return s.trim().replace(/^["']|["']$/g, '');
}

function splitFrontmatter(text) {
  if (!text.startsWith('---')) return { fm: '', body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { fm: '', body: text };
  return { fm: text.slice(3, end).trim(), body: text.slice(end + 4) };
}

function parseFrontmatter(fm) {
  const out = {};
  for (const line of fm.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    out[key] = line.slice(idx + 1).trim();
  }
  return out;
}

function parseInlineArray(val) {
  const m = val.match(/^\[(.*)\]$/s);
  if (!m) return null;
  if (m[1].trim() === '') return [];
  return m[1].split(',').map(unquote).filter(Boolean);
}

function extractLinks(str) {
  const out = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    let t = m[1].trim();
    const pipe = t.indexOf('|');
    if (pipe !== -1) t = t.slice(0, pipe).trim();
    if (t) out.push(t);
  }
  return out;
}

function parseRelations(body) {
  const edges = [];
  let inRel = false;
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      inRel = h[1].trim() === '关系';
      continue;
    }
    if (!inRel) continue;
    const m = line.match(/^\s*[-*]\s*([a-z][a-z-]*)\s+(.*)$/);
    if (!m || !RELATION_VERBS.has(m[1])) continue;
    for (const target of extractLinks(m[2])) edges.push({ relation: m[1], target });
  }
  return edges;
}

// ---------- 解析 ----------
const files = walk(WIKI_DIR);
const nodes = new Map();          // id -> node
const aliasesFromFm = new Map();  // id -> [aliases]
const edges = [];
const edgeSet = new Set();
const dangling = new Set();
let bodyLinkCount = 0;

function addEdge(source, target, relation) {
  const key = `${source}|${target}|${relation}`;
  if (edgeSet.has(key)) return;
  edgeSet.add(key);
  edges.push({ source, target, relation });
}

let filesParsed = 0;
for (const full of files) {
  const id = idFromPath(full);
  if (!id.includes('/')) continue; // 跳过 wiki 根的 aliases.md / log.md 等非实体页
  const prefix = id.split('/')[0];

  const { fm, body } = splitFrontmatter(read(full));
  const meta = parseFrontmatter(fm);

  const type = meta.type ? unquote(meta.type) : TYPE_BY_PREFIX[prefix] || 'unknown';
  const label = meta.title ? unquote(meta.title) : id.split('/').pop();
  const aliases = meta.aliases ? parseInlineArray(meta.aliases) || [] : [];
  const sources = meta.sources
    ? (parseInlineArray(meta.sources) || []).map(Number).filter((n) => !Number.isNaN(n))
    : [];

  nodes.set(id, { id, label, type, aliases, sources, degree: 0 });
  aliasesFromFm.set(id, aliases);

  for (const { relation, target } of parseRelations(body)) addEdge(id, target, relation);
  if (type === 'event' && meta.actors) {
    for (const actor of extractLinks(meta.actors)) addEdge(actor, id, 'participates-in');
  }
  bodyLinkCount += extractLinks(body).length;
  filesParsed++;
}

// 悬空链接 → stub 占位节点
function ensureNode(id) {
  if (nodes.has(id)) return;
  const prefix = id.split('/')[0];
  nodes.set(id, {
    id,
    label: id.split('/').pop(),
    type: TYPE_BY_PREFIX[prefix] || 'unknown',
    aliases: [],
    sources: [],
    degree: 0,
    stub: true,
  });
  dangling.add(id);
}
for (const e of edges) {
  ensureNode(e.source);
  ensureNode(e.target);
}

// degree
for (const e of edges) {
  nodes.get(e.source).degree++;
  nodes.get(e.target).degree++;
}

// ---------- aliases.md → 搜索索引 ----------
function parseAliasesFile() {
  const p = path.join(WIKI_DIR, 'aliases.md');
  const map = new Map();
  if (!fs.existsSync(p)) return map;
  for (const raw of read(p).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('|');
    if (parts.length < 3) continue;
    const id = parts[0].trim();
    const terms = parts[2].split(',').map((s) => s.trim()).filter(Boolean);
    if (id) map.set(id, terms);
  }
  return map;
}

const aliasFile = parseAliasesFile();
const searchIndex = [];
for (const node of nodes.values()) {
  if (node.stub) continue;
  const terms = new Set();
  if (node.label) terms.add(node.label);
  for (const a of aliasesFromFm.get(node.id) || []) terms.add(a);
  for (const a of aliasFile.get(node.id) || []) terms.add(a);
  terms.add(node.id.split('/').pop()); // 英文 slug 也可搜
  searchIndex.push({ id: node.id, label: node.label, type: node.type, terms: [...terms] });
}

// ---------- 统计 ----------
const nodesByType = {};
const edgesByRelation = {};
for (const n of nodes.values()) nodesByType[n.type] = (nodesByType[n.type] || 0) + 1;
for (const e of edges) edgesByRelation[e.relation] = (edgesByRelation[e.relation] || 0) + 1;

// ---------- 写出 ----------
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(
  path.join(OUT_DIR, 'graph-index.json'),
  JSON.stringify({ nodes: [...nodes.values()], edges })
);
fs.writeFileSync(path.join(OUT_DIR, 'search-index.json'), JSON.stringify(searchIndex));

const report = {
  generatedAt: new Date().toISOString(),
  wikiDir: WIKI_DIR,
  filesParsed,
  counts: {
    totalNodes: nodes.size,
    realNodes: nodes.size - dangling.size,
    stubNodes: dangling.size,
    totalEdges: edges.length,
    bodyInlineLinks: bodyLinkCount,
    nodesByType,
    edgesByRelation,
  },
  danglingTotal: dangling.size,
  danglingSample: [...dangling].slice(0, 50),
};
fs.writeFileSync(path.join(OUT_DIR, 'build-report.json'), JSON.stringify(report, null, 2));

console.log('✅ 构建完成');
console.log(`   文件解析: ${filesParsed}`);
console.log(`   节点: ${nodes.size} (实体 ${nodes.size - dangling.size} / 占位 ${dangling.size})`);
console.log(`   边: ${edges.length}  (正文内联链接另计 ${bodyLinkCount})`);
console.log('   节点分类:', nodesByType);
console.log('   边分类:', edgesByRelation);
console.log(`   悬空链接: ${dangling.size}`);
console.log(`   → ${OUT_DIR}`);

// ---------- 验收：trump 邻域 vs 精修图 ----------
if (VERIFY) {
  const adj = new Map();
  const push = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(b);
  };
  for (const e of edges) {
    const st = nodes.get(e.source)?.type;
    const tt = nodes.get(e.target)?.type;
    if (st === 'source' || tt === 'source') continue; // 验收时折叠 source
    push(e.source, e.target);
    push(e.target, e.source);
  }
  function bfs(start, depth) {
    const seen = new Set([start]);
    let frontier = [start];
    for (let d = 0; d < depth; d++) {
      const next = [];
      for (const u of frontier)
        for (const v of adj.get(u) || [])
          if (!seen.has(v)) { seen.add(v); next.push(v); }
      frontier = next;
    }
    return seen;
  }

  const ROOT = 'people/trump';
  console.log(`\n──────── 验收：${ROOT} 邻域（已折叠 source）────────`);
  if (!nodes.has(ROOT)) {
    console.log(`⚠ 未找到节点 ${ROOT}`);
  } else {
    for (const depth of [1, 2]) {
      const neigh = [...bfs(ROOT, depth)].filter((x) => x !== ROOT);
      const labels = neigh.map((id) => `${nodes.get(id).label}(${nodes.get(id).type})`).sort();
      console.log(`\ndepth=${depth}: ${neigh.length} 个邻居`);
      console.log('  ' + labels.join('、'));
    }
  }

  // 精修图对照
  const curatedPath = path.join(WIKI_DIR, 'graphs', 'trump-knowledge-graph.json');
  if (fs.existsSync(curatedPath)) {
    const curated = JSON.parse(read(curatedPath));
    console.log(`\n──────── 精修图 trump-knowledge-graph.json ────────`);
    console.log(`节点 ${curated.nodes.length} / 边 ${curated.edges.length}`);
    console.log('  ' + curated.nodes.map((n) => `${n.label}(${n.type_cn})`).join('、'));
  }
  console.log('\n肉眼对比：机解 depth=2 邻域是否覆盖精修图的主要实体？');
}
