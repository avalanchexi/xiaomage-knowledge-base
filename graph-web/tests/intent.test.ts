import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { degradePlan, resolvePlan, resolvePlanWithMeta } from "../src/intent";

describe("intent plan resolution", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("returns and caches a normalized successful plan", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          entity_mentions: ["Trump", "China"],
          mode: "path",
          depth: 3,
          relations: ["caused"],
          includeSources: true,
        }),
        { status: 200 },
      ),
    );

    const plan = await resolvePlan("  Trump China  ", "pro");

    expect(fetchMock).toHaveBeenCalledWith("/api/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "  Trump China  ", model: "pro" }),
    });
    expect(plan).toEqual({
      entity_mentions: ["Trump", "China"],
      mode: "path",
      depth: 3,
      relations: ["caused"],
      includeSources: true,
    });
    expect(JSON.parse(localStorage.getItem("kg:plan:trumpchina|pro") || "null")).toEqual(plan);
  });

  it("degrades to a local neighborhood plan on request failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("nope", { status: 500 }));

    await expect(resolvePlan("  Abe Shinzo  ", "flash")).resolves.toEqual({
      entity_mentions: ["Abe Shinzo"],
      mode: "neighborhood",
      depth: 2,
      relations: "all",
      includeSources: false,
    });
  });

  it("degrades two-entity relationship questions to local path mode", () => {
    expect(degradePlan("特朗普跟俄罗斯怎么联系")).toEqual({
      entity_mentions: ["特朗普", "俄罗斯"],
      mode: "path",
      depth: 2,
      relations: "all",
      includeSources: false,
    });

    expect(degradePlan("美国 俄罗斯 关系")).toMatchObject({
      entity_mentions: ["美国", "俄罗斯"],
      mode: "path",
    });
  });

  it("reports metadata degraded=false for a successful server plan identical to local degrade", async () => {
    const query = "China";
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(degradePlan(query)), { status: 200 }));

    await expect(resolvePlanWithMeta(query, "flash")).resolves.toEqual({
      plan: degradePlan(query),
      degraded: false,
    });
  });

  it("reports metadata degraded=true for request failure fallback", async () => {
    const query = "China";
    vi.mocked(fetch).mockResolvedValueOnce(new Response("nope", { status: 500 }));

    await expect(resolvePlanWithMeta(query, "flash")).resolves.toEqual({
      plan: degradePlan(query),
      degraded: true,
    });
  });

  it("returns a cached plan without a second request", async () => {
    localStorage.setItem(
      "kg:plan:trump|flash",
      JSON.stringify({
        entity_mentions: ["Donald Trump"],
        mode: "neighborhood",
        depth: 1,
        relations: "all",
        includeSources: false,
      }),
    );

    const plan = await resolvePlan(" Trump ", "flash");

    expect(fetch).not.toHaveBeenCalled();
    expect(plan.entity_mentions).toEqual(["Donald Trump"]);
  });

  it("ignores malformed cached JSON and falls back to fetch", async () => {
    localStorage.setItem("kg:plan:trump|flash", "{not-json");
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ entity_mentions: ["Trump"], mode: "path", depth: 1 }), { status: 200 }),
    );

    const plan = await resolvePlan("Trump", "flash");

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(plan.mode).toBe("path");
    expect(plan.entity_mentions).toEqual(["Trump"]);
  });

  it("ignores invalid cached plan shape and refetches", async () => {
    localStorage.setItem(
      "kg:plan:trump|flash",
      JSON.stringify({
        entity_mentions: "Trump",
        mode: "timeline",
        depth: 99,
        relations: "caused",
        includeSources: "yes",
      }),
    );
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ entity_mentions: ["Trump"], mode: "path", depth: 1, relations: "all", includeSources: false }), {
        status: 200,
      }),
    );

    const plan = await resolvePlan("Trump", "flash");

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(plan.mode).toBe("path");
    expect(plan.depth).toBe(1);
  });

  it("normalizes invalid successful response fields", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          entity_mentions: "bad",
          mode: "timeline",
          depth: 99,
          relations: "caused",
          includeSources: "yes",
        }),
        { status: 200 },
      ),
    );

    await expect(resolvePlan("  China  ", "flash")).resolves.toEqual({
      entity_mentions: ["China"],
      mode: "neighborhood",
      depth: 2,
      relations: "all",
      includeSources: false,
    });
  });

  it("does not cache request failure fallback so a later success can be fetched and cached", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ entity_mentions: ["China"], mode: "path", depth: 3, relations: "all", includeSources: true }), {
          status: 200,
        }),
      );

    await expect(resolvePlan("China", "flash")).resolves.toEqual(degradePlan("China"));
    expect(localStorage.getItem("kg:plan:china|flash")).toBeNull();

    const plan = await resolvePlan("China", "flash");

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(plan).toEqual({
      entity_mentions: ["China"],
      mode: "path",
      depth: 3,
      relations: "all",
      includeSources: true,
    });
    expect(JSON.parse(localStorage.getItem("kg:plan:china|flash") || "null")).toEqual(plan);
  });

  it("trims relation names and converts empty relation arrays to all", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ entity_mentions: ["China"], mode: "path", depth: 2, relations: [" caused ", "", " supports\t"] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ entity_mentions: ["China"], mode: "path", depth: 2, relations: [" ", ""] }), { status: 200 }),
      );

    await expect(resolvePlan("China", "flash")).resolves.toMatchObject({
      relations: ["caused", "supports"],
    });
    await expect(resolvePlan("China", "pro")).resolves.toMatchObject({
      relations: "all",
    });
  });

  it("accepts the server wrapped plan response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ plan: { entity_mentions: ["Trump"], mode: "path", depth: 3 } }), { status: 200 }),
    );

    await expect(resolvePlan("Trump", "flash")).resolves.toMatchObject({
      entity_mentions: ["Trump"],
      mode: "path",
      depth: 3,
    });
  });

  it("does not reject when localStorage write fails", async () => {
    const serverPlan = { entity_mentions: ["China"], mode: "path", depth: 3, relations: ["caused"], includeSources: true };
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(serverPlan), { status: 200 }));
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new Error("quota");
    });

    await expect(resolvePlan("China", "flash")).resolves.toEqual(serverPlan);
  });
});
