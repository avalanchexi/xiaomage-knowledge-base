import cytoscape, { type Core } from "cytoscape";
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

export function renderResult(r: AssembleResult, causal: boolean): void {
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
  if (r.mode === "path") currentCy.edges().addClass("path");

  void runLayout(currentCy, generation, causal);
}

async function runLayout(targetCy: Core, generation: number, causal: boolean): Promise<void> {
  if (causal) {
    // @ts-expect-error cytoscape-dagre has no bundled TypeScript declarations.
    const dagre = (await import("cytoscape-dagre")).default;
    if (cy !== targetCy || generation !== layoutGeneration) return;
    cytoscape.use(dagre as cytoscape.Ext);
    targetCy.layout({ name: "dagre", rankDir: "LR", nodeSep: 30, rankSep: 80 } as cytoscape.LayoutOptions).run();
  } else {
    if (cy !== targetCy || generation !== layoutGeneration) return;
    targetCy.layout({
      name: "fcose",
      quality: "proof",
      nodeSeparation: 90,
      idealEdgeLength: 90,
      packComponents: true,
      animate: false,
    } as cytoscape.LayoutOptions).run();
  }

  if (cy !== targetCy || generation !== layoutGeneration) return;
  targetCy.fit(undefined, 40);
}
