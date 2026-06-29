import type { GraphIndex, GEdge, SearchItem } from "./types";

export interface AdjLink {
  id: string;
  edge: GEdge;
  dir: "in" | "out";
}

export type Adjacency = Map<string, AdjLink[]>;

export function buildAdjacency(index: GraphIndex): Adjacency {
  const byId = new Map(index.nodes.map((n) => [n.id, n]));
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

export interface Resolved extends SearchItem {
  score: number;
  degree: number;
}

/** 解析顺序：别名/标题精确(1000) > 前缀(680) > 包含(560)；并列取 degree 高。返回去重后的实体。 */
export function resolveMentions(mentions: string[], search: SearchItem[], index: GraphIndex): Resolved[] {
  const byId = new Map(index.nodes.map((n) => [n.id, n]));
  const normalizedMentions = mentions.map(norm).filter(Boolean);
  const q = norm(mentions.join(" "));
  if (!q || normalizedMentions.length === 0) return [];
  const queries = [...new Set([q, ...normalizedMentions])];

  const scored: Resolved[] = [];
  for (const item of search) {
    const terms = [...new Set([item.label, item.id.split("/").pop() ?? "", ...item.terms].filter(Boolean).map(norm))];
    let best = 0;
    for (const term of terms) {
      if (term.length < 2) continue;
      for (const query of queries) {
        let s = 0;
        if (query === term) s = 1000;
        else if (query.includes(term)) s = 820 + Math.min(term.length, 16);
        else if (term.startsWith(query) && query.length >= 2) s = 680;
        else if (term.includes(query) && query.length >= 2) s = 560;
        if (s > best) best = s;
      }
    }
    if (best) scored.push({ ...item, score: best, degree: byId.get(item.id)?.degree ?? 0 });
  }

  scored.sort((a, b) => b.score - a.score || b.degree - a.degree);
  const seen = new Set<string>();
  const out: Resolved[] = [];
  for (const r of scored) {
    if (seen.has(r.id) || !byId.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}
