import cytoscape, { type Core, type EventObject, type NodeSingular } from "cytoscape";
// @ts-expect-error cytoscape-fcose has no bundled TypeScript declarations.
import fcose from "cytoscape-fcose";
import { cyStylesheet } from "./cy-style";
import { relationCn } from "./relations";
import type { AssembleResult } from "./types";

cytoscape.use(fcose);

let cy: Core | null = null;
let layoutGeneration = 0;

export function initCy(container: HTMLElement): Core {
  cy = cytoscape({
    container,
    style: cyStylesheet(),
    wheelSensitivity: 0.2,
    minZoom: 0.3,
    maxZoom: 3,
  });
  return cy;
}

export function wireGraphInteractions(onSelectNode: (nodeId: string | null) => void): void {
  if (!cy) throw new Error("cy not initialized");
  const currentCy = cy;

  currentCy.on("tap", "node", (event: EventObject) => {
    const node = event.target as NodeSingular;
    selectNeighborhood(currentCy, node);
    onSelectNode(node.id());
  });

  currentCy.on("tap", (event: EventObject) => {
    if (event.target !== currentCy) return;
    clearSelection(currentCy);
    onSelectNode(null);
  });

  currentCy.on("mouseover", "edge", (event: EventObject) => {
    event.target.addClass("show-label");
  });

  currentCy.on("mouseout", "edge", (event: EventObject) => {
    event.target.removeClass("show-label");
  });
}

export function renderResult(r: AssembleResult, causal: boolean, seedIds = seedIdsFromLevels(r)): void {
  if (!cy) throw new Error("cy not initialized");

  const currentCy = cy;
  const generation = ++layoutGeneration;

  currentCy.elements().remove();
  currentCy.add(r.nodes.map((n) => ({ group: "nodes" as const, data: { ...n } })));
  currentCy.add(
    r.edges.map((e, i) => ({
      group: "edges" as const,
      data: {
        id: `e${i}`,
        source: e.source,
        target: e.target,
        relation: e.relation,
        relCn: relationCn(e.relation),
      },
    })),
  );
  for (const seedId of seedIds) currentCy.$id(seedId).addClass("seed");
  if (r.mode === "path") currentCy.edges().addClass("path label-locked");

  void runLayout(currentCy, generation, causal).catch((error: unknown) => {
    if (generation === layoutGeneration) console.error("Graph layout failed", error);
  });
}

async function runLayout(targetCy: Core, generation: number, causal: boolean): Promise<void> {
  if (cy !== targetCy || generation !== layoutGeneration) return;
  targetCy.layout({
    name: "fcose",
    quality: "proof",
    fit: true,
    padding: 48,
    nodeSeparation: causal ? 130 : 118,
    nodeRepulsion: () => (causal ? 7000 : 6400),
    idealEdgeLength: causal ? 128 : 116,
    tilingPaddingVertical: 18,
    tilingPaddingHorizontal: 18,
    packComponents: true,
    animate: false,
  } as cytoscape.LayoutOptions).run();

  if (cy !== targetCy || generation !== layoutGeneration) return;
  targetCy.fit(undefined, 48);
}

function selectNeighborhood(targetCy: Core, node: NodeSingular): void {
  clearSelection(targetCy);
  const relatedEdges = node.connectedEdges();
  const neighbors = relatedEdges.connectedNodes();
  const highlightedNodes = neighbors.union(node);

  targetCy.nodes().not(highlightedNodes).addClass("dim");
  targetCy.edges().not(relatedEdges).addClass("dim");
  highlightedNodes.addClass("hl highlight");
  relatedEdges.addClass("hl highlight label-locked");
  node.select();
}

function clearSelection(targetCy: Core): void {
  targetCy.elements().removeClass("dim hl highlight show-label");
  targetCy.edges().not(".path").removeClass("label-locked");
  targetCy.nodes().unselect();
}

function seedIdsFromLevels(r: AssembleResult): string[] {
  return r.nodes.filter((node) => r.levels.get(node.id) === 0).map((node) => node.id);
}
