import { describe, it, expect } from "vitest";
import { RELATION_TYPES, relationCn, relationPlanToSelection, relationSelectionToPlan, typeMeta } from "../src/relations";

describe("relations/type mapping", () => {
  it("maps relation schema to Chinese", () => {
    expect(relationCn("participates-in")).toBe("参与");
    expect(relationCn("supports")).toBe("支持");
    expect(relationCn("unknown-x")).toBe("unknown-x");
  });
  it("maps core visible types to distinct shapes (colorblind aid)", () => {
    const shapes = ["person","country","event","take","org"].map(t => typeMeta(t).shape);
    expect(new Set(shapes).size).toBe(shapes.length);
  });
  it("falls back to stub metadata for unknown types", () => {
    expect(typeMeta("unknown")).toEqual(typeMeta("stub"));
  });
  it("maps relation filter selections to query-plan relations", () => {
    expect(relationSelectionToPlan([])).toEqual([]);
    expect(relationSelectionToPlan(RELATION_TYPES)).toBe("all");
    expect(relationSelectionToPlan(["caused", "supports"])).toEqual(["caused", "supports"]);
    expect(relationSelectionToPlan(["caused", "unknown-x", "caused"])).toEqual(["caused"]);
  });
  it("keeps all and none relation filter selections distinct", () => {
    expect(relationPlanToSelection("all")).toEqual(new Set(RELATION_TYPES));
    expect(relationPlanToSelection([])).toEqual(new Set());
  });
});
