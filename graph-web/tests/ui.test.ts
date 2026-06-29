import { afterEach, describe, expect, it, vi } from "vitest";
import { openWiki, renderIntentLine, setStateBody, setWikiLabelResolver } from "../src/ui";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

    expect(document.getElementById("intentLine")?.textContent).not.toContain("MVP \u672c\u5730\u56de\u9000");
    expect(document.getElementById("intentLine")?.textContent).not.toContain("\u672c\u5730\u56de\u9000");

    renderIntentLine({
      matches: [],
      mode: "neighborhood",
      depth: 2,
      model: "flash",
      causal: false,
      includeSources: false,
      state: "ready",
      note: "\u672c\u5730\u56de\u9000",
    });

    expect(document.getElementById("intentLine")?.textContent).toContain("\u672c\u5730\u56de\u9000");
  });
});

describe("status and wiki rendering", () => {
  it("updates compact state bodies by id", () => {
    document.body.innerHTML = '<div id="emptyState">old</div>';

    setStateBody("emptyState", "\u5df2\u751f\u6210");

    expect(document.getElementById("emptyState")?.textContent).toBe("\u5df2\u751f\u6210");
  });

  it("renders wiki internal links as graph labels", async () => {
    document.body.innerHTML = `
      <div id="wikiModal" hidden>
        <div id="wikiModalTitle"></div>
        <div id="wikiModalMeta"></div>
        <div id="wikiModalBody"></div>
      </div>
    `;
    setWikiLabelResolver((id) => ({
      "events/yellen-trade-war-criticism-2021": "\u8036\u4f26\u6279\u8bc4\u4e2d\u7f8e\u8d38\u6613\u6218",
      "countries/china": "\u4e2d\u56fd",
    })[id]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(
        "---\ntitle: Test\ntype: source\n---\n- \u4e8b\u4ef6\uff1a[[events/yellen-trade-war-criticism-2021]]\n- \u4e3b\u4f53\uff1a[[countries/china]]\n- participates-in [[events/yellen-trade-war-criticism-2021]]",
      )),
    );

    await openWiki("/wiki/sources/80.md", "Test");

    const text = document.getElementById("wikiModalBody")?.textContent || "";
    expect(text).toContain("\u4e8b\u4ef6\uff1a\u8036\u4f26\u6279\u8bc4\u4e2d\u7f8e\u8d38\u6613\u6218");
    expect(text).toContain("\u4e3b\u4f53\uff1a\u4e2d\u56fd");
    expect(text).toContain("\u53c2\u4e0e \u8036\u4f26\u6279\u8bc4\u4e2d\u7f8e\u8d38\u6613\u6218");
    expect(text).not.toContain("[[events/yellen-trade-war-criticism-2021]]");
    expect(text).not.toContain("participates-in");
  });
});
