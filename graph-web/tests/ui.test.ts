import { describe, expect, it } from "vitest";
import { renderIntentLine } from "../src/ui";

describe("intent line rendering", () => {
  it("shows local fallback only when the fallback note is present", () => {
    document.body.innerHTML = '<div id="intentLine"></div>';

    renderIntentLine({
      matches: [],
      mode: "neighborhood",
      depth: 2,
      model: "flash",
      causal: false,
      includeSources: false,
      state: "ready",
    });

    expect(document.getElementById("intentLine")?.textContent).not.toContain("MVP 本地回退");
    expect(document.getElementById("intentLine")?.textContent).not.toContain("本地回退");

    renderIntentLine({
      matches: [],
      mode: "neighborhood",
      depth: 2,
      model: "flash",
      causal: false,
      includeSources: false,
      state: "ready",
      note: "本地回退",
    });

    expect(document.getElementById("intentLine")?.textContent).toContain("本地回退");
  });
});
