import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: ".",
  plugins: [react()],
  server: { host: "0.0.0.0", port: 4173 },
  build: { outDir: "dist", emptyOutDir: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./tests/setup.ts",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
  },
});
