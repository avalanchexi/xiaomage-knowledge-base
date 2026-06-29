import { assemble } from "./assemble";
import { buildAdjacency, resolveMentions } from "./data";
import { initCy, renderResult, wireGraphInteractions } from "./render";
import {
  addHistorySession,
  filteredResult,
  getHiddenTypes,
  openWiki,
  renderDetails,
  renderHistory,
  renderIntentLine,
  renderLegend,
  setStatus,
  splitMentions,
  wireWikiModal,
} from "./ui";
import type { AssembleResult, EntityType, GNode, GraphIndex, Mode, QueryPlan, SearchItem } from "./types";

const ENTITY_TYPES: EntityType[] = ["person", "org", "country", "event", "take", "source", "stub"];

type AppState = {
  graph: GraphIndex;
  search: SearchItem[];
  byId: Map<string, GNode>;
  rawResult: AssembleResult | null;
  visibleResult: AssembleResult | null;
  query: string;
  selectedId: string | null;
};

async function main(): Promise<void> {
  const graphContainer = requiredEl("graph");
  const queryInput = requiredEl<HTMLInputElement>("query");
  const depthInput = requiredEl<HTMLInputElement>("depth");
  const depthSegments = requiredEl("depthSegments");
  const causalMode = requiredEl<HTMLInputElement>("causalMode");
  const includeSources = requiredEl<HTMLInputElement>("includeSources");
  const modelSelect = requiredEl<HTMLSelectElement>("modelSelect");

  setStatus("正在加载本地索引...");
  const [graph, search] = await Promise.all([loadJson<GraphIndex>("data/graph-index.json"), loadSearchIndex("data/search-index.json")]);
  const adj = buildAdjacency(graph);
  const state: AppState = {
    graph,
    search,
    byId: new Map(graph.nodes.map((node) => [node.id, node])),
    rawResult: null,
    visibleResult: null,
    query: "",
    selectedId: null,
  };

  initCy(graphContainer);
  wireWikiModal();
  wireGraphInteractions((nodeId) => {
    state.selectedId = nodeId;
    renderSelectedDetails(state);
  });

  const rerenderCurrent = () => {
    if (!state.rawResult) return;
    applyVisibleResult(state, causalMode.checked);
  };

  renderLegend([], rerenderCurrent);
  renderHistory((query) => {
    queryInput.value = query;
    runQuery(query, false);
  });

  document.getElementById("searchForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    runQuery(queryInput.value, true);
  });

  depthSegments.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-depth]");
    if (!button?.dataset.depth) return;
    setDepth(depthInput, depthSegments, button.dataset.depth);
    if (state.query) runQuery(state.query, false);
    else renderIntentLine(currentIntentArgs(modelSelect, causalMode, includeSources, "waiting"));
  });

  includeSources.addEventListener("change", () => {
    if (state.query) runQuery(state.query, false);
  });
  causalMode.addEventListener("change", () => {
    if (state.query) runQuery(state.query, false);
  });

  document.getElementById("saveCurrentGraph")?.addEventListener("click", () => {
    if (!state.query || !state.visibleResult) {
      setStatus("当前没有可保存的图。");
      return;
    }
    addHistorySession(state.query, state.visibleResult.mode, state.visibleResult.nodes.length);
    renderHistory((query) => {
      queryInput.value = query;
      runQuery(query, false);
    });
    setStatus(`已保存到本地：${state.query}`);
  });

  setDepth(depthInput, depthSegments, depthInput.value || "2");
  const initialQuery = queryInput.value.trim();
  if (initialQuery) runQuery(initialQuery, false);
  else {
    renderResult(emptyResult(), false);
    renderDetails(null, graph, openWiki);
    renderIntentLine(currentIntentArgs(modelSelect, causalMode, includeSources, "waiting"));
    setStatus("本地索引已加载，等待输入。");
  }

  function runQuery(query: string, recordHistory: boolean): void {
    const trimmed = query.trim();
    state.query = trimmed;
    state.selectedId = null;

    if (!trimmed) {
      state.rawResult = emptyResult();
      state.visibleResult = state.rawResult;
      renderResult(state.visibleResult, causalMode.checked);
      renderLegend([], rerenderCurrent);
      renderDetails(null, graph, openWiki);
      renderIntentLine(currentIntentArgs(modelSelect, causalMode, includeSources, "waiting"));
      setStatus("请输入实体或一句话。");
      return;
    }

    const mentions = splitMentions(trimmed);
    const matches = resolveQueryMentions(mentions, state.search, graph);
    if (!matches.length) {
      state.rawResult = emptyResult();
      state.visibleResult = state.rawResult;
      renderResult(state.visibleResult, causalMode.checked);
      renderLegend([], rerenderCurrent);
      renderDetails(null, graph, openWiki);
      renderIntentLine(currentIntentArgs(modelSelect, causalMode, includeSources, "no-hit"));
      setStatus(`未命中：${trimmed}`);
      return;
    }

    const mode = inferMode(trimmed, matches.length);
    const plan: QueryPlan = {
      entity_mentions: matches.map((match) => match.id),
      mode,
      depth: readDepth(depthInput),
      relations: "all",
      includeSources: includeSources.checked,
    };
    state.rawResult = assemble(graph, adj, plan);
    applyVisibleResult(state, causalMode.checked);
    renderIntentLine({
      matches: matches.map((match) => state.byId.get(match.id) ?? match).slice(0, 2),
      mode: state.visibleResult?.mode ?? mode,
      depth: plan.depth,
      model: modelSelect.value,
      causal: causalMode.checked,
      includeSources: includeSources.checked,
      state: "ready",
      note: state.rawResult.note ? "未找到直连路径，已回退邻域" : undefined,
    });
    setStatus(
      `${modeCn(state.visibleResult?.mode ?? mode)} · ${state.visibleResult?.nodes.length ?? 0} 节点 · ${
        state.visibleResult?.edges.length ?? 0
      } 边${state.rawResult.truncated ? " · 已截断" : ""}`,
    );

    if (recordHistory && state.visibleResult) {
      addHistorySession(trimmed, state.visibleResult.mode, state.visibleResult.nodes.length);
      renderHistory((savedQuery) => {
        queryInput.value = savedQuery;
        runQuery(savedQuery, false);
      });
    }
  }
}

function applyVisibleResult(state: AppState, causal: boolean): void {
  if (!state.rawResult) return;
  const visible = filteredResult(state.rawResult, getHiddenTypes());
  state.visibleResult = visible;
  if (state.selectedId && !visible.nodes.some((node) => node.id === state.selectedId)) state.selectedId = null;
  renderResult(visible, causal);
  renderLegend(state.rawResult.nodes, () => applyVisibleResult(state, causal));
  if (!state.selectedId) state.selectedId = visible.nodes[0]?.id ?? null;
  renderSelectedDetails(state);
}

function renderSelectedDetails(state: AppState): void {
  const node = state.selectedId ? state.byId.get(state.selectedId) : null;
  renderDetails(node, { nodes: state.graph.nodes, edges: state.visibleResult?.edges ?? [] }, (href, title) => {
    void openWiki(href, title);
  });
}

async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return (await response.json()) as T;
}

async function loadSearchIndex(url: string): Promise<SearchItem[]> {
  const raw = await loadJson<Array<Partial<SearchItem>>>(url);
  return raw
    .filter((item): item is Partial<SearchItem> & { id: string; label: string } =>
      typeof item.id === "string" && typeof item.label === "string",
    )
    .map((item) => ({
      id: item.id,
      label: item.label,
      type: isEntityType(item.type) ? item.type : "stub",
      terms: Array.isArray(item.terms) ? item.terms.filter((term): term is string => typeof term === "string") : [],
    }));
}

function isEntityType(type: unknown): type is EntityType {
  return typeof type === "string" && (ENTITY_TYPES as string[]).includes(type);
}

function inferMode(query: string, matchCount: number): Mode {
  return matchCount >= 2 && /关系|怎么|之间|联系|连/.test(query) ? "path" : "neighborhood";
}

function resolveQueryMentions(mentions: string[], search: SearchItem[], graph: GraphIndex): SearchItem[] {
  const globalMatches = resolveMentions(mentions, search, graph);
  const tokenMatches: SearchItem[] = [];
  for (const mention of mentions) {
    if (/^(关系|怎么|之间|联系|连)$/.test(mention)) continue;
    const match = resolveMentions([mention], search, graph)[0];
    if (match) tokenMatches.push(match);
  }

  const seen = new Set<string>();
  const out: SearchItem[] = [];
  for (const match of [...tokenMatches, ...globalMatches]) {
    if (seen.has(match.id)) continue;
    seen.add(match.id);
    out.push(match);
  }
  return out;
}

function readDepth(input: HTMLInputElement): number {
  const parsed = Number.parseInt(input.value, 10);
  return Number.isFinite(parsed) ? Math.min(3, Math.max(1, parsed)) : 2;
}

function setDepth(input: HTMLInputElement, segments: HTMLElement, value: string): void {
  input.value = value;
  for (const button of Array.from(segments.querySelectorAll<HTMLButtonElement>("[data-depth]"))) {
    button.classList.toggle("on", button.dataset.depth === value);
  }
}

function currentIntentArgs(
  modelSelect: HTMLSelectElement,
  causalMode: HTMLInputElement,
  includeSources: HTMLInputElement,
  state: "waiting" | "no-hit",
): Parameters<typeof renderIntentLine>[0] {
  return {
    depth: Number.parseInt((document.getElementById("depth") as HTMLInputElement | null)?.value ?? "2", 10),
    model: modelSelect.value,
    causal: causalMode.checked,
    includeSources: includeSources.checked,
    state,
  };
}

function emptyResult(): AssembleResult {
  return { mode: "neighborhood", nodes: [], edges: [], levels: new Map(), pathIds: new Set(), truncated: false };
}

function modeCn(mode: Mode): string {
  return mode === "path" ? "路径" : "邻域";
}

function requiredEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  setStatus(`加载失败：${message}`, true);
  console.error(error);
});
