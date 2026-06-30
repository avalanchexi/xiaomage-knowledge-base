import { createReadStream } from "node:fs";
import { cp, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, ResolvedConfig } from "vite";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const wikiRoot = path.resolve(here, "../小马哥知识库/wiki");

export default defineConfig({
  root: ".",
  plugins: [wikiMarkdownPlugin()],
  server: { host: "0.0.0.0", port: 4173 },
  build: { outDir: "dist", emptyOutDir: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./tests/setup.ts",
    include: ["tests/**/*.test.ts", "tests/**/*.test.mjs"],
    exclude: ["node_modules", "dist"],
  },
});

function wikiMarkdownPlugin(): Plugin {
  let resolvedConfig: ResolvedConfig;

  return {
    name: "kg-wiki-markdown",
    configResolved(config) {
      resolvedConfig = config;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
        if (!pathname.startsWith("/wiki/")) {
          next();
          return;
        }

        let requested: string;
        try {
          requested = decodeURIComponent(pathname.slice("/wiki/".length));
        } catch {
          res.statusCode = 400;
          res.end("Bad request");
          return;
        }
        const file = path.resolve(wikiRoot, requested);
        if (!isInside(wikiRoot, file)) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }

        try {
          const info = await stat(file);
          if (!info.isFile()) {
            next();
            return;
          }
          res.setHeader("Content-Type", "text/markdown; charset=utf-8");
          const stream = createReadStream(file);
          stream.once("error", (error) => {
            if (!res.headersSent) {
              res.statusCode = 500;
              res.end(`Failed to read wiki markdown: ${error instanceof Error ? error.message : String(error)}`);
              return;
            }
            res.destroy(error instanceof Error ? error : undefined);
          });
          stream.pipe(res);
        } catch {
          next();
        }
      });
    },
    async closeBundle() {
      if (resolvedConfig.command !== "build") return;
      const outDir = path.resolve(resolvedConfig.root, resolvedConfig.build.outDir);
      const target = path.join(outDir, "wiki");
      const rootInfo = await stat(wikiRoot).catch(() => null);
      if (!rootInfo?.isDirectory()) {
        throw new Error(`Wiki root not found: ${wikiRoot}. Run/restore 小马哥知识库/wiki before building graph-web.`);
      }
      await cp(wikiRoot, target, { recursive: true, force: true });
    },
  };
}

function isInside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
