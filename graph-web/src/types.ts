export type EntityType = "person" | "org" | "country" | "event" | "take" | "source" | "stub";

export interface GNode {
  id: string; label: string; type: EntityType;
  aliases: string[]; sources: number[]; degree: number; stub?: boolean;
}
export interface GEdge { source: string; target: string; relation: string; }
export interface GraphIndex { nodes: GNode[]; edges: GEdge[]; }
export interface SearchItem { id: string; label: string; type: EntityType; terms: string[]; }

export type Mode = "neighborhood" | "path";
export interface QueryPlan {
  entity_mentions: string[];
  mode: Mode;
  depth: number;
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
