import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadLocalEnv } from "../scripts/local-env.mjs";

describe("local env loader", () => {
  let tempDir;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("overrides an existing DeepSeek placeholder in the target env", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "graph-web-env-"));
    const envPath = path.join(tempDir, ".env");
    const env = {
      DEEPSEEK_API_KEY: "invalid-placeholder",
      KEEP_ME: "unchanged",
    };

    await writeFile(
      envPath,
      [
        "# local test env",
        "export DEEPSEEK_API_KEY='test-local-key'",
        'DEEPSEEK_MODEL_FLASH="test-flash"',
        "",
      ].join("\n"),
      "utf8",
    );

    await loadLocalEnv(envPath, env);

    expect(env).toEqual({
      DEEPSEEK_API_KEY: "test-local-key",
      DEEPSEEK_MODEL_FLASH: "test-flash",
      KEEP_ME: "unchanged",
    });
  });
});
