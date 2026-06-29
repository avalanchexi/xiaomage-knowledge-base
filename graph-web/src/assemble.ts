import type { GraphIndex, GNode, GEdge, QueryPlan, AssembleResult } from "./types";
import type { Adjacency } from "./data";

export const MAX_NODES = 70;
export const MAX_EDGES = 180;

const relAllowed = (rel: string, relations: QueryPlan["relations"]) =>
  relations === "all" || relations.includes(rel);

const nodeAllowed = (node: GNode, plan: QueryPlan) => plan.includeSources || node.type !== "source";

export function assemble(index: GraphIndex, adj: Adjacency, plan: QueryPlan): AssembleResult {
  const byId = new Map(index.nodes.map((n) => [n.id, n]));
  const seeds = plan.entity_mentions.filter((id) => {
    const node = byId.get(id);
    return node && nodeAllowed(node, plan);
  });

  if (plan.mode === "path" && seeds.length >= 2) {
    const path = shortestPath(adj, byId, seeds[0], seeds[1], plan);
    if (path) return buildPathResult(byId, path);

    return {
      ...neighborhood(index, adj, byId, seeds.slice(0, 2), plan),
      note: "未找到 ≤跳数 的连接，回退邻域",
    };
  }

  return neighborhood(index, adj, byId, seeds.slice(0, 1), plan);
}

function neighborhood(
  index: GraphIndex,
  adj: Adjacency,
  byId: Map<string, GNode>,
  seedIds: string[],
  plan: QueryPlan,
): AssembleResult {
  const visible = new Set(seedIds);
  const levels = new Map(seedIds.map((id) => [id, 0]));
  const queue = seedIds.map((id) => ({ id, level: 0 }));
  let truncated = false;

  while (queue.length && visible.size < MAX_NODES) {
    const cur = queue.shift()!;
    if (cur.level >= plan.depth) continue;

    for (const link of adj.get(cur.id) ?? []) {
      const node = byId.get(link.id);
      if (!node || !nodeAllowed(node, plan)) continue;
      if (!relAllowed(link.edge.relation, plan.relations)) continue;

      if (!visible.has(link.id)) {
        visible.add(link.id);
        levels.set(link.id, cur.level + 1);
        queue.push({ id: link.id, level: cur.level + 1 });

        if (visible.size >= MAX_NODES) {
          truncated = true;
          break;
        }
      }
    }
  }

  const nodes = [...visible].map((id) => byId.get(id)!).filter(Boolean);
  const allEdges = visibleEdgesFor(index, byId, visible, plan);
  const edges = allEdges.slice(0, MAX_EDGES);

  return {
    mode: "neighborhood",
    nodes,
    edges,
    levels,
    pathIds: new Set(),
    truncated: truncated || allEdges.length > MAX_EDGES,
  };
}

function shortestPath(
  adj: Adjacency,
  byId: Map<string, GNode>,
  startId: string,
  endId: string,
  plan: QueryPlan,
): { ids: string[]; edges: GEdge[] } | null {
  const start = byId.get(startId);
  const end = byId.get(endId);
  if (!start || !end || !nodeAllowed(start, plan) || !nodeAllowed(end, plan)) return null;

  const queue = [startId];
  const prev = new Map<string, { from: string; edge: GEdge }>();
  const seen = new Set([startId]);
  let head = 0;

  while (head < queue.length) {
    const cur = queue[head++];
    if (cur === endId) break;

    for (const link of adj.get(cur) ?? []) {
      const node = byId.get(link.id);
      if (!node || !nodeAllowed(node, plan)) continue;
      if (!relAllowed(link.edge.relation, plan.relations)) continue;
      if (seen.has(link.id)) continue;

      seen.add(link.id);
      prev.set(link.id, { from: cur, edge: link.edge });
      if (link.id === endId) return reconstructPath(prev, startId, endId);
      queue.push(link.id);
    }
  }

  if (startId === endId) return { ids: [startId], edges: [] };
  return null;
}

function reconstructPath(
  prev: Map<string, { from: string; edge: GEdge }>,
  startId: string,
  endId: string,
): { ids: string[]; edges: GEdge[] } | null {
  const ids = [endId];
  const edges: GEdge[] = [];
  let current = endId;

  while (current !== startId) {
    const step = prev.get(current);
    if (!step) return null;
    ids.push(step.from);
    edges.push(step.edge);
    current = step.from;
  }

  ids.reverse();
  edges.reverse();
  return { ids, edges };
}

function buildPathResult(byId: Map<string, GNode>, path: { ids: string[]; edges: GEdge[] }): AssembleResult {
  const levels = new Map(path.ids.map((id, i) => [id, i]));

  return {
    mode: "path",
    nodes: path.ids.map((id) => byId.get(id)!).filter(Boolean),
    edges: path.edges.slice(0, MAX_EDGES),
    levels,
    pathIds: new Set(path.ids),
    truncated: path.edges.length > MAX_EDGES,
  };
}

function visibleEdgesFor(index: GraphIndex, byId: Map<string, GNode>, visible: Set<string>, plan: QueryPlan): GEdge[] {
  return index.edges.filter((e) => {
    if (!visible.has(e.source) || !visible.has(e.target)) return false;
    if (!relAllowed(e.relation, plan.relations)) return false;

    const source = byId.get(e.source);
    const target = byId.get(e.target);
    return Boolean(source && target && nodeAllowed(source, plan) && nodeAllowed(target, plan));
  });
}
