import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const wiki = path.join(here, "fixtures/wiki");
const script = path.join(here, "../scripts/build-graph.mjs");

let graph: any, search: any, report: any;

beforeAll(() => {
  const out = mkdtempSync(path.join(tmpdir(), "kg-build-"));
  execFileSync("node", [script, wiki, "--out", out], { stdio: "pipe" });
  graph = JSON.parse(readFileSync(path.join(out, "graph-index.json"), "utf8"));
  search = JSON.parse(readFileSync(path.join(out, "search-index.json"), "utf8"));
  report = JSON.parse(readFileSync(path.join(out, "build-report.json"), "utf8"));
});

describe("build-graph", () => {
  const node = (id: string) => graph.nodes.find((n: any) => n.id === id);
  const hasEdge = (s: string, t: string, r: string) =>
    graph.edges.some((e: any) => e.source === s && e.target === t && e.relation === r);

  it("parses frontmatter into typed nodes", () => {
    expect(node("people/trump")).toMatchObject({ label: "特朗普", type: "person", sources: [2, 4] });
    expect(node("people/trump").aliases).toContain("懂王");
  });
  it("parses ## 关系 edges (relation + target)", () => {
    expect(hasEdge("people/trump", "events/trade-war", "participates-in")).toBe(true);
    expect(hasEdge("people/trump", "takes/maga", "about")).toBe(true);
    expect(hasEdge("people/trump", "sources/2", "derived-from")).toBe(true);
    expect(hasEdge("people/trump", "sources/4", "derived-from")).toBe(true);
  });
  it("derives participates-in edges from event actors", () => {
    expect(hasEdge("people/trump", "events/trade-war", "participates-in")).toBe(true);
    expect(hasEdge("countries/china", "events/trade-war", "participates-in")).toBe(true);
  });
  it("creates stub nodes for dangling links and reports them", () => {
    expect(node("events/missing-page")).toMatchObject({ stub: true, type: "event" });
    expect(report.danglingSample).toContain("events/missing-page");
  });
  it("skips top-level meta files (aliases.md) as entities", () => {
    expect(graph.nodes.some((n: any) => n.id === "aliases")).toBe(false);
  });
  it("builds search index terms from aliases.md + title", () => {
    const item = search.find((s: any) => s.id === "people/trump");
    expect(item.terms).toEqual(expect.arrayContaining(["特朗普", "懂王", "川建国"]));
  });
  it("computes degree", () => {
    expect(node("people/trump").degree).toBeGreaterThanOrEqual(2);
  });
  it("supports --out without treating the output directory as the wiki directory", () => {
    const out = mkdtempSync(path.join(tmpdir(), "kg-build-default-"));
    execFileSync("node", [script, "--out", out], { stdio: "pipe" });
    const defaultReport = JSON.parse(readFileSync(path.join(out, "build-report.json"), "utf8"));

    expect(path.resolve(defaultReport.wikiDir)).not.toBe(path.resolve(out));
    expect(defaultReport.filesParsed).toBeGreaterThan(0);
  });
});
