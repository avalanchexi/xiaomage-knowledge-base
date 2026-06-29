import type { QueryPlan } from "./types";

export type IntentModel = "flash" | "pro";
export type ResolvedPlan = { plan: QueryPlan; degraded: boolean };

export function degradePlan(query: string): QueryPlan {
  return {
    entity_mentions: [query.trim()],
    mode: "neighborhood",
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
    depth: plan.depth === 1 || plan.depth === 2 || plan.depth === 3 ? plan.depth : 2,
    relations,
    includeSources: typeof plan.includeSources === "boolean" ? plan.includeSources : false,
  };
}

function normalizeRelations(relations: unknown): QueryPlan["relations"] {
  if (relations === "all") return "all";
  if (!Array.isArray(relations)) return "all";
  const normalized = relations
    .filter((relation): relation is string => typeof relation === "string")
    .map((relation) => relation.trim())
    .filter(Boolean);
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
    (plan.depth === 1 || plan.depth === 2 || plan.depth === 3) &&
    (plan.relations === "all" || Array.isArray(plan.relations)) &&
    typeof plan.includeSources === "boolean"
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}
