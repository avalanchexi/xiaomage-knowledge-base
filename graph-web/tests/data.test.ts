import { describe, it, expect } from "vitest";
import { buildAdjacency, resolveMentions } from "../src/data";
import type { GraphIndex, SearchItem } from "../src/types";

const index: GraphIndex = {
  nodes: [
    { id: "people/trump", label: "特朗普", type: "person", aliases: ["懂王", "川普"], sources: [], degree: 5 },
    { id: "countries/us", label: "美国", type: "country", aliases: ["美国", "老美"], sources: [], degree: 9 },
    { id: "countries/russia", label: "俄罗斯", type: "country", aliases: ["俄罗斯"], sources: [], degree: 3 },
    { id: "takes/us-lower-degree", label: "美国观点", type: "take", aliases: ["美国"], sources: [], degree: 2 },
  ],
  edges: [
    { source: "people/trump", target: "countries/us", relation: "participates-in" },
    { source: "countries/us", target: "countries/russia", relation: "about" },
    { source: "countries/us", target: "missing/node", relation: "about" },
  ],
};
const search: SearchItem[] = index.nodes.map((n) => ({
  id: n.id,
  label: n.label,
  type: n.type,
  terms: [n.label, ...n.aliases],
}));

describe("data layer", () => {
  it("builds undirected adjacency ordered by degree with direction metadata", () => {
    const adj = buildAdjacency(index);

    expect(adj.get("countries/us")).toEqual([
      {
        id: "people/trump",
        edge: { source: "people/trump", target: "countries/us", relation: "participates-in" },
        dir: "in",
      },
      {
        id: "countries/russia",
        edge: { source: "countries/us", target: "countries/russia", relation: "about" },
        dir: "out",
      },
    ]);
    expect([...adj.values()].flat().some((l) => l.id === "missing/node")).toBe(false);
  });

  it("resolves alias exact match (懂王 -> trump)", () => {
    const r = resolveMentions(["懂王"], search, index);
    expect(r[0].id).toBe("people/trump");
  });

  it("matches each mention independently for fuzzy prefixes", () => {
    const r = resolveMentions(["特朗", "俄罗"], search, index);
    expect(r.map((m) => m.id)).toEqual(["people/trump", "countries/russia"]);
    expect(r.map((m) => m.score)).toEqual([680, 680]);
  });

  it("on same-score ambiguity prefers higher degree", () => {
    const r = resolveMentions(["美国"], search, index);
    expect(r.slice(0, 2).map((m) => m.id)).toEqual(["countries/us", "takes/us-lower-degree"]);
    expect(r[0].score).toBe(r[1].score);
  });

  it("excludes search matches whose ids are missing from the graph", () => {
    const missingSearch: SearchItem[] = [
      ...search,
      { id: "countries/missing", label: "不存在国", type: "country", terms: ["不存在国"] },
    ];

    expect(resolveMentions(["不存在国"], missingSearch, index)).toEqual([]);
  });

  it("dedupes duplicate search entries", () => {
    const r = resolveMentions(["懂王"], [...search, search[0]], index);
    expect(r.filter((m) => m.id === "people/trump")).toHaveLength(1);
  });

  it("returns empty for no match", () => {
    expect(resolveMentions(["不存在xyz"], search, index)).toEqual([]);
  });
});
