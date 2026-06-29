import { assemble } from "./assemble";
import { buildAdjacency, resolveMentions } from "./data";
import { resolvePlanWithMeta, type IntentModel } from "./intent";
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
  renderRelationFilters,
  setStateBody,
  setStatus,
  setWikiLabelResolver,
  wireWikiModal,
} from "./ui";
import type { AssembleResult, EntityType, GNode, GraphIndex, QueryPlan, SearchItem } from "./types";

const ENTITY_TYPES: EntityType[] = ["person", "org", "country", "event", "take", "source", "stub"];

type AppState = {
  graph: GraphIndex;
  search: SearchItem[];
  byId: Map<string, GNode>;
  rawResult: AssembleResult | null;
  visibleResult: AssembleResult | null;
  query: string;
  selectedId: string | null;
  currentPlan: QueryPlan | null;
  currentMatches: SearchItem[];
  currentModel: IntentModel | null;
  fallbackIntent: boolean;
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
  setStateBody("indexState", "正在读取索引");
  setStateBody("emptyState", "请输入");
  setStateBody("deepseekState", "等待检测");
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
    currentPlan: null,
    currentMatches: [],
    currentModel: null,
    fallbackIntent: false,
  };
  let requestId = 0;
  let depthOverridden = false;
  let sourcesOverridden = false;
  let relationFilter: QueryPlan["relations"] | null = null;

  initCy(graphContainer);
  wireWikiModal();
  setWikiLabelResolver((id) => state.byId.get(id)?.label);
  wireGraphInteractions((nodeId) => {
    state.selectedId = nodeId;
    renderSelectedDetails(state);
  });

  const rerenderCurrent = () => {
    if (!state.rawResult) return;
    applyVisibleResult(state, causalMode.checked);
  };

  renderLegend([], rerenderCurrent);
  renderRelationFilters("all", applyRelationFilter);
  renderHistory((query) => {
    queryInput.value = query;
    void runQuery(query, false);
  });

  document.getElementById("searchForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void runQuery(queryInput.value, true);
  });

  depthSegments.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-depth]");
    if (!button?.dataset.depth) return;
    depthOverridden = true;
    setDepth(depthInput, depthSegments, button.dataset.depth);
    if (state.query) reassembleCurrent();
    else renderIntentLine(currentIntentArgs(modelSelect, causalMode, includeSources, "waiting"));
  });

  includeSources.addEventListener("change", () => {
    sourcesOverridden = true;
    if (state.query) reassembleCurrent();
  });
  causalMode.addEventListener("change", () => {
    if (state.query) reassembleCurrent();
  });
  modelSelect.addEventListener("change", () => {
    if (state.query) void runQuery(state.query, false);
  });

  document.getElementById("saveCurrentGraph")?.addEventListener("click", () => {
    if (!state.query || !state.visibleResult) {
      setStatus("当前没有可保存的图。");
      return;
    }
    addHistorySession(state.query, state.visibleResult.mode, state.visibleResult.nodes.length);
    renderHistory((query) => {
      queryInput.value = query;
      void runQuery(query, false);
    });
    setStatus(`已保存到本地：${state.query}`);
  });

  setDepth(depthInput, depthSegments, depthInput.value || "2");
  const initialQuery = queryInput.value.trim();
  if (initialQuery) void runQuery(initialQuery, false);
  else {
    renderResult(emptyResult(), false);
    renderDetails(null, graph, openWiki);
    renderIntentLine(currentIntentArgs(modelSelect, causalMode, includeSources, "waiting"));
    setStatus("本地索引已加载，等待输入。");
    setStateBody("indexState", "已加载");
    setStateBody("emptyState", "请输入");
  }

  async function runQuery(query: string, recordHistory: boolean): Promise<void> {
    const activeRequest = ++requestId;
    const trimmed = query.trim();
    state.query = trimmed;
    state.selectedId = null;
    state.currentPlan = null;
    state.currentMatches = [];
    state.currentModel = null;
    state.fallbackIntent = false;

    if (!trimmed) {
      state.rawResult = emptyResult();
      state.visibleResult = state.rawResult;
      renderResult(state.visibleResult, causalMode.checked);
      renderLegend([], rerenderCurrent);
      renderDetails(null, graph, openWiki);
      renderIntentLine(currentIntentArgs(modelSelect, causalMode, includeSources, "waiting"));
      setStatus("请输入实体或一句话。");
      setStateBody("emptyState", "请输入");
      return;
    }

    setStatus("正在解析搜索意图...");
    setStateBody("emptyState", "正在生成");
    setStateBody("deepseekState", "检测中");
    const model = readModel(modelSelect);
    const { plan: modelPlan, degraded } = await resolvePlanWithMeta(trimmed, model);
    if (activeRequest !== requestId) return;

    state.fallbackIntent = degraded;
    setStateBody("deepseekState", degraded ? "不可用，已本地回退" : "可用");
    if (!depthOverridden) setDepth(depthInput, depthSegments, String(modelPlan.depth));
    if (!sourcesOverridden) includeSources.checked = modelPlan.includeSources;

    const matches = resolveMentions(modelPlan.entity_mentions, state.search, graph);
    if (!matches.length) {
      state.rawResult = emptyResult();
      state.visibleResult = state.rawResult;
      renderResult(state.visibleResult, causalMode.checked);
      renderLegend([], rerenderCurrent);
      renderDetails(null, graph, openWiki);
      renderIntentLine(currentIntentArgs(modelSelect, causalMode, includeSources, "no-hit"));
      setStatus(`未命中：${trimmed}`);
      setStateBody("emptyState", "未命中");
      return;
    }

    state.currentMatches = matches;
    state.currentModel = model;
    state.currentPlan = {
      entity_mentions: matches.map((match) => match.id),
      mode: modelPlan.mode,
      depth: modelPlan.depth,
      relations: relationFilter ?? modelPlan.relations,
      includeSources: modelPlan.includeSources,
    };
    renderRelationFilters(state.currentPlan.relations, applyRelationFilter);
    reassembleCurrent();
    setStateBody("emptyState", "已生成");

    if (recordHistory && state.visibleResult) {
      addHistorySession(trimmed, state.visibleResult.mode, state.visibleResult.nodes.length);
      renderHistory((savedQuery) => {
        queryInput.value = savedQuery;
        void runQuery(savedQuery, false);
      });
    }
  }

  function reassembleCurrent(): void {
    if (!state.currentPlan || !state.currentMatches.length) return;
    const plan: QueryPlan = {
      ...state.currentPlan,
      depth: readDepth(depthInput),
      includeSources: includeSources.checked,
    };
    state.rawResult = assemble(graph, adj, plan);
    applyVisibleResult(state, causalMode.checked);
    const note = [
      state.fallbackIntent ? "本地回退" : "",
      state.rawResult.note ? "未找到直连路径，已回退邻域" : "",
    ].filter(Boolean).join(" / ");
    renderIntentLine({
      matches: state.currentMatches.map((match) => state.byId.get(match.id) ?? match).slice(0, 2),
      mode: state.visibleResult?.mode ?? plan.mode,
      depth: plan.depth,
      model: state.currentModel ?? modelSelect.value,
      causal: causalMode.checked,
      includeSources: includeSources.checked,
      state: "ready",
      note: note || undefined,
    });
    setStatus(
      `${modeCn(state.visibleResult?.mode ?? plan.mode)} / ${state.visibleResult?.nodes.length ?? 0} 节点 / ${
        state.visibleResult?.edges.length ?? 0
      } 边${state.rawResult.truncated ? " / 已截断" : ""}`,
    );
  }

  function applyRelationFilter(relations: QueryPlan["relations"]): void {
    relationFilter = relations;
    renderRelationFilters(relationFilter, applyRelationFilter);
    if (!state.query || !state.currentPlan) return;
    state.currentPlan = { ...state.currentPlan, relations: relationFilter };
    void runQuery(state.query, false);
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

function readDepth(input: HTMLInputElement): number {
  return normalizeDepth(input.value);
}

function readModel(select: HTMLSelectElement): IntentModel {
  return select.value === "pro" ? "pro" : "flash";
}

function setDepth(input: HTMLInputElement, segments: HTMLElement, value: string): void {
  const normalized = String(normalizeDepth(value));
  input.value = normalized;
  for (const button of Array.from(segments.querySelectorAll<HTMLButtonElement>("[data-depth]"))) {
    button.classList.toggle("on", button.dataset.depth === normalized);
  }
}

function normalizeDepth(value: string | number): number {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? Math.min(2, Math.max(1, parsed)) : 2;
}

function currentIntentArgs(
  modelSelect: HTMLSelectElement,
  causalMode: HTMLInputElement,
  includeSources: HTMLInputElement,
  state: "waiting" | "no-hit",
): Parameters<typeof renderIntentLine>[0] {
  return {
    depth: normalizeDepth((document.getElementById("depth") as HTMLInputElement | null)?.value ?? "2"),
    model: modelSelect.value,
    causal: causalMode.checked,
    includeSources: includeSources.checked,
    state,
  };
}

function emptyResult(): AssembleResult {
  return { mode: "neighborhood", nodes: [], edges: [], levels: new Map(), pathIds: new Set(), truncated: false };
}

function modeCn(mode: QueryPlan["mode"]): string {
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
  setStateBody("indexState", "加载失败");
  console.error(error);
});
