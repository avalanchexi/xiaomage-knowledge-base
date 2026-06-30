import { describe, expect, it } from "vitest";
import { createQueryOverrideState } from "../src/query-overrides";

describe("query override state", () => {
  it("resets manual depth and source overrides for a new user query", () => {
    const state = createQueryOverrideState();
    state.markDepthOverridden();
    state.markSourcesOverridden();

    state.resetForRun(true);

    expect(state.depthOverridden).toBe(false);
    expect(state.sourcesOverridden).toBe(false);
  });

  it("keeps manual overrides for internal reruns", () => {
    const state = createQueryOverrideState();
    state.markDepthOverridden();
    state.markSourcesOverridden();

    state.resetForRun(false);

    expect(state.depthOverridden).toBe(true);
    expect(state.sourcesOverridden).toBe(true);
  });
});
