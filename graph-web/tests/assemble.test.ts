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
    { id: "events/isolated", label: "I", type: "event", aliases: [], sources: [], degree: 0 },
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
    const ids = r.nodes.map((n) => n.id).sort();
    expect(ids).toContain("people/a");
    expect(ids).toContain("events/b");
    expect(ids).toContain("takes/t");
    expect(ids).not.toContain("sources/1");
  });

  it("neighborhood traverses undirected (reaches C via B at depth 2)", () => {
    const r = assemble(idx, adj, plan({ entity_mentions: ["people/a"], depth: 2 }));
    expect(r.nodes.map((n) => n.id)).toContain("countries/c");
  });

  it("includeSources shows source nodes", () => {
    const r = assemble(idx, adj, plan({ entity_mentions: ["people/a"], depth: 1, includeSources: true }));
    expect(r.nodes.map((n) => n.id)).toContain("sources/1");
  });

  it("source seed is hidden unless includeSources is true", () => {
    const hidden = assemble(idx, adj, plan({ entity_mentions: ["sources/1"], depth: 1, includeSources: false }));
    expect(hidden.nodes.map((n) => n.id)).not.toContain("sources/1");

    const visible = assemble(idx, adj, plan({ entity_mentions: ["sources/1"], depth: 1, includeSources: true }));
    expect(visible.nodes.map((n) => n.id)).toContain("sources/1");
  });

  it("relations filter keeps a non-empty listed relation neighborhood", () => {
    const r = assemble(idx, adj, plan({ entity_mentions: ["events/b"], depth: 1, relations: ["caused"] }));
    expect(r.nodes.map((n) => n.id).sort()).toEqual(["countries/c", "events/b"]);
    expect(r.edges).toEqual([{ source: "events/b", target: "countries/c", relation: "caused" }]);
  });

  it("relations filter with an empty list keeps only seeds and no edges", () => {
    const r = assemble(idx, adj, plan({ entity_mentions: ["events/b"], depth: 1, relations: [] }));
    expect(r.nodes.map((n) => n.id)).toEqual(["events/b"]);
    expect(r.edges).toEqual([]);
  });

  it("path mode returns shortest path A->C", () => {
    const r = assemble(idx, adj, plan({ entity_mentions: ["people/a", "countries/c"], mode: "path" }));
    expect(r.mode).toBe("path");
    expect(r.nodes.map((n) => n.id)).toEqual(["people/a", "events/b", "countries/c"]);
  });

  it("path mode finds connected shortest paths longer than five edges", () => {
    const ids = Array.from({ length: 8 }, (_, i) => `events/${i}`);
    const chain: GraphIndex = {
      nodes: ids.map((id, i) => ({
        id,
        label: String(i),
        type: "event",
        aliases: [],
        sources: [],
        degree: i === 0 || i === ids.length - 1 ? 1 : 2,
      })),
      edges: ids.slice(0, -1).map((id, i) => ({ source: id, target: ids[i + 1], relation: "caused" })),
    };

    const r = assemble(
      chain,
      buildAdjacency(chain),
      plan({ entity_mentions: [ids[0], ids[ids.length - 1]], mode: "path" }),
    );

    expect(r.mode).toBe("path");
    expect(r.nodes.map((n) => n.id)).toEqual(ids);
    expect(r.edges).toHaveLength(ids.length - 1);
  });

  it("path mode keeps relation filtering active", () => {
    const r = assemble(idx, adj, plan({ entity_mentions: ["people/a", "countries/c"], mode: "path", relations: ["about"] }));
    expect(r.mode).toBe("neighborhood");
    expect(r.note).toBeTruthy();
    expect(r.pathIds.size).toBe(0);
  });

  it("path mode with unreachable pair returns note + falls back empty path", () => {
    const r = assemble(idx, adj, plan({ entity_mentions: ["takes/t", "events/isolated"], mode: "path" }));
    expect(r.mode).toBe("neighborhood");
    expect(r.note).toBeTruthy();
    expect(r.pathIds.size).toBe(0);
  });

  it("returns an empty neighborhood for invalid seeds", () => {
    const r = assemble(idx, adj, plan({ entity_mentions: ["missing/node"], depth: 2 }));
    expect(r.nodes).toEqual([]);
    expect(r.edges).toEqual([]);
    expect(r.levels.size).toBe(0);
  });
});
