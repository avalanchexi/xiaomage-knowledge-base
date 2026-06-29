import { describe, it, expect } from "vitest";
import { relationCn, typeMeta } from "../src/relations";

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
});
