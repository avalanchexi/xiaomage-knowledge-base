import type cytoscape from "cytoscape";
import type { EntityType, QueryPlan } from "./types";

export type NodeShape = cytoscape.Css.NodeShape;

export const RELATION_CN: Record<string, string> = {
  "mentions": "提及", "participates-in": "参与", "about": "论及",
  "opposes": "对立", "caused": "导致", "part-of": "隶属",
  "derived-from": "源自", "supports": "支持", "contradicts": "矛盾",
};
export const RELATION_TYPES = Object.keys(RELATION_CN);
export const relationCn = (r: string) => RELATION_CN[r] ?? r;

export function relationSelectionToPlan(
  selected: Iterable<string>,
  relationTypes: readonly string[] = RELATION_TYPES,
): QueryPlan["relations"] {
  const selectedSet = new Set([...selected].map((relation) => relation.trim()).filter(Boolean));
  const normalized = relationTypes.filter((relation) => selectedSet.has(relation));
  return normalized.length === relationTypes.length ? "all" : normalized;
}

export function relationPlanToSelection(
  relations: QueryPlan["relations"],
  relationTypes: readonly string[] = RELATION_TYPES,
): Set<string> {
  return new Set(relations === "all" ? relationTypes : relationTypes.filter((relation) => relations.includes(relation)));
}

// 颜色 + 形状双编码（色盲友好）。形状取 Cytoscape 合法值。
export const TYPE_META: Record<EntityType, { cn: string; color: string; shape: NodeShape }> = {
  person:  { cn: "人物", color: "#6f55d4", shape: "ellipse" },
  country: { cn: "国家", color: "#2f9b57", shape: "hexagon" },
  event:   { cn: "事件", color: "#3f7fce", shape: "round-rectangle" },
  take:    { cn: "观点", color: "#d98a20", shape: "diamond" },
  org:     { cn: "组织", color: "#1f9d8a", shape: "round-tag" },
  source:  { cn: "原文", color: "#9aa0a6", shape: "ellipse" },
  stub:    { cn: "占位", color: "#c6a15b", shape: "ellipse" },
};
export const typeMeta = (t: string) => TYPE_META[(t as EntityType)] ?? TYPE_META.stub;
