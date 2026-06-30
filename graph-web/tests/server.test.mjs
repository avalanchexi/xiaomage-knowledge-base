import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGraphServer } from "../server.mjs";

describe("graph-web server", () => {
  let distRoot;
  let distDir;
  let server;
  let fetchImpl;

  beforeEach(async () => {
    distRoot = await mkdtemp(path.join(tmpdir(), "graph-web-server-"));
    distDir = path.join(distRoot, "dist");
    await mkdir(distDir, { recursive: true });
    await writeFile(path.join(distDir, "index.html"), "<!doctype html><main>SPA shell</main>", "utf8");

    fetchImpl = vi.fn();
    server = createGraphServer({ distDir, env: {}, fetchImpl });
    await listen(server);
  });

  afterEach(async () => {
    if (server?.listening) {
      await close(server);
    }
    if (distRoot) {
      await rm(distRoot, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("serves index HTML for SPA routes without file extensions", async () => {
    const response = await fetch(`${baseUrl(server)}/people/trump`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    await expect(response.text()).resolves.toContain("SPA shell");
  });

  it("blocks path traversal outside the configured dist directory", async () => {
    const response = await fetch(`${baseUrl(server)}/..%2Fpackage.json`);

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("Forbidden");
  });

  it("degrades /api/intent without an API key and does not call upstream fetch", async () => {
    const response = await fetch(`${baseUrl(server)}/api/intent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "Trump China relationship" }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "no_key", degrade: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function baseUrl(server) {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not bind to a TCP port");
  }
  return `http://127.0.0.1:${address.port}`;
}
