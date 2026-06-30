import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./local-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await loadLocalEnv(path.resolve(__dirname, "..", ".env"));

const { createGraphServer } = await import("../server.mjs");
const port = Number(process.env.PORT || 4173);
const server = createGraphServer();

server.listen(port, () => {
  console.log(`graph-web server listening on http://localhost:${port}`);
});
