import type { QueryPlan } from "./types";
import { RELATION_TYPES } from "./relations";

export type IntentModel = "flash" | "pro";
export type ResolvedPlan = { plan: QueryPlan; degraded: boolean };

export function degradePlan(query: string): QueryPlan {
  const trimmed = query.trim();
  const localMentions = localPathMentions(trimmed);
  return {
    entity_mentions: localMentions,
    mode: localMentions.length >= 2 ? "path" : "neighborhood",
    depth: 2,
    relations: "all",
    includeSources: false,
  };
}

export async function resolvePlan(query: string, model: IntentModel): Promise<QueryPlan> {
  return (await resolvePlanWithMeta(query, model)).plan;
}

export async function resolvePlanWithMeta(query: string, model: IntentModel): Promise<ResolvedPlan> {
  const key = cacheKey(query, model);
  const cached = readCachedPlan(key, query);
  if (cached) return { plan: cached, degraded: false };

  try {
    const response = await fetch("/api/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, model }),
    });
    if (!response.ok) throw new Error(`intent request failed: ${response.status}`);
    const raw = await response.json();
    if (!isObject(raw)) throw new Error("intent response is not an object");
    const plan = normalizePlan(raw, query);
    writeCachedPlan(key, plan);
    return { plan, degraded: false };
  } catch {
    return { plan: degradePlan(query), degraded: true };
  }
}

function cacheKey(query: string, model: IntentModel): string {
  return `kg:plan:${query.trim().toLowerCase().replace(/\s+/g, "")}|${model}`;
}

function readCachedPlan(key: string, query: string): QueryPlan | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidCachedPlanShape(parsed)) return null;
    return normalizePlan(parsed, query);
  } catch {
    return null;
  }
}

function writeCachedPlan(key: string, plan: QueryPlan): void {
  try {
    localStorage.setItem(key, JSON.stringify(plan));
  } catch {
    // Storage can fail in private mode or under quota pressure; plan resolution should still succeed.
  }
}

function normalizePlan(raw: unknown, query: string): QueryPlan {
  if (!isObject(raw)) return degradePlan(query);
  const maybeWrapped = raw as { plan?: unknown };
  const plan = (isObject(maybeWrapped.plan) ? maybeWrapped.plan : raw) as Partial<QueryPlan>;
  const mentions = Array.isArray(plan.entity_mentions)
    ? plan.entity_mentions.filter((mention): mention is string => typeof mention === "string" && mention.trim().length > 0)
    : [];
  const relations = normalizeRelations(plan.relations);

  return {
    entity_mentions: mentions.length ? mentions : [query.trim()],
    mode: plan.mode === "path" || plan.mode === "neighborhood" ? plan.mode : "neighborhood",
    depth: normalizeDepth(plan.depth),
    relations,
    includeSources: typeof plan.includeSources === "boolean" ? plan.includeSources : false,
  };
}

function normalizeDepth(depth: unknown): number {
  const parsed = typeof depth === "number" ? depth : Number.parseInt(String(depth), 10);
  return parsed === 1 || parsed === 2 || parsed === 3 || parsed === 4 ? parsed : 2;
}

function normalizeRelations(relations: unknown): QueryPlan["relations"] {
  if (relations === "all") return "all";
  if (!Array.isArray(relations)) return "all";
  const selected = new Set(relations
    .filter((relation): relation is string => typeof relation === "string")
    .map((relation) => relation.trim())
    .filter(Boolean));
  const normalized = RELATION_TYPES.filter((relation) => selected.has(relation));
  return normalized.length ? normalized : "all";
}

function isValidCachedPlanShape(raw: unknown): boolean {
  if (!isObject(raw)) return false;
  const maybeWrapped = raw as { plan?: unknown };
  const plan = (isObject(maybeWrapped.plan) ? maybeWrapped.plan : raw) as Partial<QueryPlan>;
  return (
    Array.isArray(plan.entity_mentions) &&
    plan.entity_mentions.some((mention) => typeof mention === "string" && mention.trim().length > 0) &&
    (plan.mode === "path" || plan.mode === "neighborhood") &&
    (plan.depth === 1 || plan.depth === 2 || plan.depth === 3 || plan.depth === 4) &&
    (plan.relations === "all" || Array.isArray(plan.relations)) &&
    typeof plan.includeSources === "boolean"
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

const PATH_INTENT_RE = /(关系|怎么连|怎么联系|如何联系|关联|路径|连通|连接|联系)/;
const PATH_CLEANUP_RE = /(怎么连|怎么联系|如何联系|什么关系|有何关系|什么关联|怎么关联|如何关联|关系|关联|路径|连通|连接|联系|之间|有什么|如何|怎么|的)/g;
const PAIR_SPLIT_RE = /(?:\s+|跟|和|与|同|及|到|至|、|,|，|\/|\+|->|→|vs\.?)/i;

function localPathMentions(query: string): string[] {
  if (!query || !PATH_INTENT_RE.test(query)) return query ? [query] : [];
  const cleaned = query.replace(PATH_CLEANUP_RE, " ").replace(/[?？]/g, " ");
  const unique: string[] = [];
  for (const part of cleaned.split(PAIR_SPLIT_RE).map((item) => item.trim()).filter(Boolean)) {
    if (!unique.includes(part)) unique.push(part);
    if (unique.length === 2) break;
  }
  return unique.length >= 2 ? unique : [query];
}
