import type cytoscape from "cytoscape";
import { TYPE_META } from "./relations";

export function cyStylesheet(): cytoscape.StylesheetJson {
  const typeSelectors = (Object.keys(TYPE_META) as (keyof typeof TYPE_META)[]).map((t) => ({
    selector: `node[type = "${t}"]`,
    style: { "background-color": TYPE_META[t].color, shape: TYPE_META[t].shape },
  }));

  return [
    {
      selector: "node",
      style: {
        width: "mapData(degree, 0, 20, 18, 46)",
        height: "mapData(degree, 0, 20, 18, 46)",
        label: "data(label)",
        "font-size": 11,
        color: "#24272b",
        "text-valign": "bottom",
        "text-margin-y": 4,
        "text-max-width": "120px",
        "text-wrap": "ellipsis",
        "text-outline-color": "#fff",
        "text-outline-width": 2,
      },
    },
    ...typeSelectors,
    { selector: "node:selected", style: { "border-color": "#111827", "border-width": 3 } },
    { selector: "node.dim", style: { opacity: 0.28 } },
    { selector: "node.hl, node.highlight", style: { "border-color": "#0a84ff", "border-width": 2 } },
    {
      selector: "edge",
      style: {
        width: 1.4,
        "line-color": "#c9cdd3",
        "target-arrow-color": "#a4a8ae",
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
        label: "",
        "font-size": 9,
        color: "#075fb8",
        "text-background-color": "#fff",
        "text-background-opacity": 0.85,
        "text-background-padding": "1px",
      },
    },
    { selector: "edge.show-label", style: { label: "data(relCn)" } },
    { selector: "edge.dim", style: { opacity: 0.16 } },
    {
      selector: "edge.hl, edge.highlight",
      style: { "line-color": "#0a84ff", "target-arrow-color": "#0a84ff", width: 2.3 },
    },
    { selector: "edge.path", style: { "line-color": "#5a6069", width: 2.2 } },
  ];
}
