import { assemble } from "./assemble";
import { buildAdjacency } from "./data";
import { initCy, renderResult } from "./render";
import type { GraphIndex } from "./types";

async function main(): Promise<void> {
  const status = document.getElementById("status");
  const graphContainer = document.getElementById("graph");
  if (!graphContainer) throw new Error("Missing #graph container");

  const response = await fetch("data/graph-index.json");
  if (!response.ok) throw new Error(`Failed to load graph-index.json: ${response.status}`);

  const graph: GraphIndex = await response.json();
  const adj = buildAdjacency(graph);

  initCy(graphContainer);
  renderResult(
    assemble(graph, adj, {
      entity_mentions: ["people/trump"],
      mode: "neighborhood",
      depth: 2,
      relations: "all",
      includeSources: false,
    }),
    false,
  );
  if (status) status.textContent = "已加载本地索引 · 渲染特朗普 depth-2 子图";
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const status = document.getElementById("status");
  if (status) status.textContent = `加载失败：${message}`;
  console.error(error);
});
