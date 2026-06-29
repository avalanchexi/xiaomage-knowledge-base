import { RELATION_TYPES, relationCn, relationPlanToSelection, relationSelectionToPlan, typeMeta } from "./relations";
import type { AssembleResult, GEdge, GNode, GraphIndex, Mode, QueryPlan } from "./types";

const HISTORY_KEY = "kg:graphs";
const MAX_HISTORY = 12;

type HistoryItem = {
  query: string;
  mode: Mode;
  nodeCount: number;
  t: number;
};

type Child = Node | string | number | null | undefined | Child[];

const hiddenTypes = new Set<string>();
let history: HistoryItem[] = loadHistory();
let closeWikiBound = false;
let wikiRequestId = 0;
let wikiLabelResolver: ((id: string) => string | undefined) | null = null;

export function splitMentions(q: string): string[] {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/[\s,，、]+/).filter(Boolean);
  return [...new Set([trimmed, ...parts])];
}

export function getHiddenTypes(): Set<string> {
  return new Set(hiddenTypes);
}

export function setStateBody(id: string, message: string): void {
  const node = document.getElementById(id);
  if (node) node.textContent = message;
}

export function setWikiLabelResolver(resolve: (id: string) => string | undefined): void {
  wikiLabelResolver = resolve;
}

export function renderLegend(nodes: GNode[], onChange: () => void): void {
  const legend = document.getElementById("legend");
  if (!legend) return;

  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);

  for (const button of Array.from(legend.querySelectorAll<HTMLButtonElement>("[data-type]"))) {
    const type = button.dataset.type ?? "";
    const count = counts.get(type) ?? 0;
    const hidden = hiddenTypes.has(type);
    button.disabled = count === 0;
    button.classList.toggle("off", hidden && count > 0);
    button.classList.toggle("empty", count === 0);
    button.setAttribute("aria-pressed", String(!hidden));
    button.title = count ? `${typeMeta(type).cn}: ${count}` : `${typeMeta(type).cn}: 当前图无节点`;
    const countEl = button.querySelector<HTMLElement>(".legend-count");
    if (countEl) countEl.textContent = count ? String(count) : "";

    if (button.dataset.wiredLegend !== "1") {
      button.dataset.wiredLegend = "1";
      button.addEventListener("click", () => {
        const clickedType = button.dataset.type;
        if (!clickedType || button.disabled) return;
        if (hiddenTypes.has(clickedType)) hiddenTypes.delete(clickedType);
        else hiddenTypes.add(clickedType);
        onChange();
      });
    }
  }
}

export function renderRelationFilters(
  relations: QueryPlan["relations"],
  onChange: (relations: QueryPlan["relations"]) => void,
): void {
  const root = document.getElementById("relationFilters");
  if (!root) return;

  const active = relationPlanToSelection(relations);
  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-relation]"))) {
    const relation = button.dataset.relation ?? "";
    const known = RELATION_TYPES.includes(relation);
    const pressed = known && active.has(relation);
    button.disabled = !known;
    button.classList.toggle("off", known && !pressed);
    button.classList.toggle("empty", !known);
    button.setAttribute("aria-pressed", String(pressed));
    button.title = known ? `${relationCn(relation)} / ${relation}` : relation;

    if (button.dataset.wiredRelation !== "1") {
      button.dataset.wiredRelation = "1";
      button.addEventListener("click", () => {
        const clickedRelation = button.dataset.relation;
        if (!clickedRelation || button.disabled) return;
        const selected = selectedRelationsFromButtons(root);
        if (selected.has(clickedRelation)) selected.delete(clickedRelation);
        else selected.add(clickedRelation);
        onChange(relationSelectionToPlan(selected));
      });
    }
  }
}

export function renderDetails(
  node: GNode | null | undefined,
  graph: Pick<GraphIndex, "nodes" | "edges">,
  openWiki: (href: string, title: string) => void,
): void {
  const details = document.getElementById("details");
  if (!details) return;

  clear(details);
  if (!node) {
    details.append(el("h2", {}, "没有选中节点"), el("p", { class: "muted" }, "点击图中的节点查看关系和来源。"));
    return;
  }

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const visibleRels = graph.edges.filter((edge) => edge.source === node.id || edge.target === node.id).slice(0, 14);

  details.append(
    el("h2", {}, node.label || node.id),
    el("div", { class: "meta" }, `${typeMeta(node.type).cn} · ${node.id} · 关系 ${node.degree ?? 0}`),
    el("div", { class: "section-title" }, "别名"),
    chipLine(node.aliases?.length ? node.aliases.slice(0, 12) : ["无"]),
    el("div", { class: "section-title" }, "当前图内关系"),
  );

  if (!visibleRels.length) {
    details.append(el("p", { class: "muted" }, "当前视图内没有直接关系。"));
  } else {
    for (const edge of visibleRels) {
      const isOut = edge.source === node.id;
      const other = byId.get(isOut ? edge.target : edge.source);
      const targetText = `${isOut ? "到" : "来自"} ${other?.label || other?.id || ""}`;
      details.append(
        el("div", { class: "rel-row" }, [
          el("b", {}, relationCn(edge.relation)),
          el("span", { class: "rel-target", title: targetText }, targetText),
        ]),
      );
    }
  }

  details.append(
    el("div", { class: "section-title" }, "原文来源"),
    sourceList((node.sources || []).slice(0, 16), byId, openWiki),
    wikiLinkForNode(node, openWiki),
  );
}

export function renderHistory(runSaved: (query: string) => void): void {
  const list = document.getElementById("historyList");
  if (!list) return;
  clear(list);

  const clearButton = document.querySelector<HTMLElement>("[data-clear-history]");
  if (clearButton && clearButton.dataset.wiredHistoryClear !== "1") {
    clearButton.dataset.wiredHistoryClear = "1";
    clearButton.addEventListener("click", () => {
      clearHistory();
      renderHistory(runSaved);
      setStatus("已清空本地历史。");
    });
  }

  if (!history.length) {
    list.append(el("div", { class: "muted", style: "padding:10px 8px;font-size:12px;" }, "暂无记录"));
    return;
  }

  for (const item of history) {
    const saveButton = el("button", {
      type: "button",
      class: "history-action save",
      title: "保存本地",
      "aria-label": `保存 ${item.query}`,
    }, "保存本地");
    const deleteButton = el("button", {
      type: "button",
      class: "history-action delete",
      title: "删除",
      "aria-label": `删除 ${item.query}`,
    }, "删除");
    const row = el("div", { class: "history-item", role: "button", tabindex: "0" }, [
      el("div", { class: "history-main" }, [
        el("strong", {}, item.query),
        el("span", {}, `${modeCn(item.mode)} · ${item.nodeCount} 节点`),
      ]),
      el("div", { class: "history-actions", "aria-label": "本地操作" }, [
        el("button", { type: "button", class: "history-more", title: "本地操作", "aria-label": `本地操作 ${item.query}` }, "..."),
        el("div", { class: "history-menu" }, [saveButton, deleteButton]),
      ]),
    ]);

    row.addEventListener("click", (event) => {
      if ((event.target as Element).closest(".history-actions")) return;
      runSaved(item.query);
    });
    row.addEventListener("keydown", (event) => {
      if ((event.target as Element).closest(".history-actions")) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      runSaved(item.query);
    });
    saveButton.addEventListener("click", (event) => {
      event.stopPropagation();
      addHistorySession(item.query, item.mode, item.nodeCount);
      renderHistory(runSaved);
      setStatus(`已保存到本地：${item.query}`);
    });
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      history = history.filter((historyItem) => historyItem.query !== item.query);
      saveHistory();
      renderHistory(runSaved);
      setStatus(`已删除本地记录：${item.query}`);
    });
    list.append(row);
  }
}

export function addHistorySession(query: string, mode: Mode, nodeCount: number): void {
  const trimmed = query.trim();
  if (!trimmed) return;
  history = [{ query: trimmed, mode, nodeCount, t: Date.now() }, ...history.filter((item) => item.query !== trimmed)].slice(
    0,
    MAX_HISTORY,
  );
  saveHistory();
}

export function clearHistory(): void {
  history = [];
  saveHistory();
}

export function wireWikiModal(): void {
  if (closeWikiBound) return;
  closeWikiBound = true;
  document.addEventListener("click", (event) => {
    if ((event.target as Element).closest("[data-close-wiki]")) closeWikiModal();
  });
  document.addEventListener("keydown", (event) => {
    const modal = document.getElementById("wikiModal") as HTMLElement | null;
    if (event.key === "Escape" && modal && !modal.hidden) closeWikiModal();
  });
}

export async function openWiki(href: string, title = "Wiki"): Promise<void> {
  const requestId = ++wikiRequestId;
  const modal = requiredEl<HTMLElement>("wikiModal");
  const modalTitle = requiredEl<HTMLElement>("wikiModalTitle");
  const meta = requiredEl<HTMLElement>("wikiModalMeta");
  const body = requiredEl<HTMLElement>("wikiModalBody");
  const url = new URL(href, location.href).href;

  modal.hidden = false;
  modalTitle.textContent = title;
  clear(meta);
  clear(body);
  meta.append(el("span", { class: "tag" }, "只读"));
  body.append(el("div", { class: "wiki-loading" }, "正在读取 wiki 内容..."));

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const text = new TextDecoder("utf-8").decode(await response.arrayBuffer());
    if (requestId !== wikiRequestId) return;
    if (/^\s*<!doctype html/i.test(text) || /^\s*<html[\s>]/i.test(text)) {
      throw new Error("wiki markdown is not available");
    }
    const parsed = parseWikiMarkdown(text);
    const pathLabel = decodeURIComponent(new URL(url).pathname.split("/wiki/").pop() || url);
    modalTitle.textContent = parsed.title || title || pathLabel;
    clear(meta);
    const metaItems = [
      ["类型", parsed.meta.type],
      ["来源", parsed.meta.sources],
      ["创建", parsed.meta.created],
      ["更新", parsed.meta.updated],
      ["编号", parsed.meta.article_no],
      ["路径", pathLabel],
    ].filter(([, value]) => value);
    for (const [label, value] of metaItems) meta.append(el("span", { class: "tag" }, `${label}: ${cleanMetaValue(value)}`));
    if (!metaItems.length) meta.append(el("span", { class: "tag" }, "只读"));
    clear(body);
    renderMarkdownBlocks(body, parsed.body);
  } catch (error) {
    if (requestId !== wikiRequestId) return;
    modalTitle.textContent = title;
    clear(meta);
    clear(body);
    meta.append(el("span", { class: "tag" }, "读取失败"));
    body.append(el("div", { class: "wiki-error" }, `无法读取 wiki 内容：${error instanceof Error ? error.message : String(error)}`));
  }
}

export function renderIntentLine(args: {
  matches?: Array<Pick<GNode, "id" | "label" | "type">>;
  mode?: Mode;
  depth: number;
  model: string;
  causal: boolean;
  includeSources: boolean;
  state?: "waiting" | "no-hit" | "ready";
  note?: string;
}): void {
  const intentLine = document.getElementById("intentLine");
  if (!intentLine) return;
  clear(intentLine);
  intentLine.append(el("span", {}, "DeepSeek 解析："));

  if (args.state === "waiting") {
    intentLine.append(el("span", { class: "tag" }, "等待输入"));
    return;
  }
  if (args.state === "no-hit") {
    intentLine.append(el("span", { class: "tag" }, "未命中"));
    return;
  }

  for (const item of (args.matches ?? []).slice(0, 2)) {
    intentLine.append(el("span", { class: "pill" }, [
      el("span", { class: "dot", style: `background:${typeMeta(item.type).color}` }),
      document.createTextNode(item.label || item.id),
    ]));
  }
  intentLine.append(el("span", { class: "tag" }, args.mode === "path" ? "路径模式" : "邻域模式"));
  intentLine.append(el("span", { class: "tag" }, `深度 ${args.depth}`));
  intentLine.append(el("span", { class: "tag" }, args.model === "pro" ? "pro" : "flash"));
  if (args.causal) intentLine.append(el("span", { class: "tag" }, "因果/层级"));
  if (args.includeSources) intentLine.append(el("span", { class: "tag" }, "含原文"));
  if (args.note) intentLine.append(el("span", { class: "tag" }, args.note));
}

export function setStatus(message: string, isError = false): void {
  const status = document.getElementById("status");
  if (!status) return;
  status.classList.toggle("error", isError);
  status.textContent = message;
}

export function filteredResult(result: AssembleResult, hidden: Set<string>): AssembleResult {
  if (!hidden.size) return result;
  const nodes = result.nodes.filter((node) => !hidden.has(node.type));
  const visible = new Set(nodes.map((node) => node.id));
  return {
    ...result,
    nodes,
    edges: result.edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target)),
    levels: new Map([...result.levels].filter(([id]) => visible.has(id))),
    pathIds: new Set([...result.pathIds].filter((id) => visible.has(id))),
  };
}

function sourceList(sourceNumbers: number[], byId: Map<string, GNode>, openWiki: (href: string, title: string) => void): HTMLElement {
  if (!sourceNumbers.length) return chipLine(["无"]);
  const wrap = el("div", { class: "source-list" });
  for (const sourceNo of sourceNumbers) {
    const sourceId = `sources/${sourceNo}`;
    const sourceNode = byId.get(sourceId);
    const title = sourceNode?.label || `原文 #${sourceNo}`;
    const href = `/wiki/${sourceId}.md`;
    const row = el("a", { class: "source-row", href, rel: "noreferrer", title }, [
      el("span", { class: "source-no" }, `#${sourceNo}`),
      el("span", { class: "source-title" }, title),
    ]);
    row.addEventListener("click", (event) => {
      event.preventDefault();
      openWiki(href, title);
    });
    wrap.append(row);
  }
  return wrap;
}

function wikiLinkForNode(node: GNode, openWiki: (href: string, title: string) => void): HTMLElement {
  const href = `/wiki/${node.id}.md`;
  const link = el("a", { class: "wiki-link", href, rel: "noreferrer" }, "打开 wiki 页");
  link.addEventListener("click", (event) => {
    event.preventDefault();
    openWiki(href, node.label || node.id);
  });
  return link;
}

function parseWikiMarkdown(text: string): { meta: Record<string, string>; body: string; title: string } {
  const normalized = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const meta: Record<string, string> = {};
  let body = normalized.trim();

  if (normalized.startsWith("---\n")) {
    const end = normalized.indexOf("\n---", 4);
    if (end > -1) {
      const frontmatter = normalized.slice(4, end).trim().split("\n");
      for (const line of frontmatter) {
        const match = line.match(/^([^:]+):\s*(.*)$/);
        if (match) meta[match[1].trim()] = match[2].trim();
      }
      body = normalized.slice(end + 4).trim();
    }
  }

  const heading = body.match(/^#\s+(.+)$/m);
  return { meta, body, title: cleanMetaValue(meta.title) || heading?.[1]?.trim() || "" };
}

function renderMarkdownBlocks(container: HTMLElement, markdown: string): void {
  const lines = String(markdown || "").split("\n");
  let paragraph: string[] = [];
  let list: HTMLElement | null = null;
  let inCode = false;
  let codeLines: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    container.append(el("p", {}, renderWikiInline(paragraph.join(" "))));
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    container.append(list);
    list = null;
  };
  const flushCode = () => {
    container.append(el("pre", {}, codeLines.join("\n")));
    codeLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (inCode) {
        inCode = false;
        flushCode();
      } else {
        flushParagraph();
        flushList();
        inCode = true;
        codeLines = [];
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const tag = `h${Math.min(heading[1].length + 1, 3)}` as keyof HTMLElementTagNameMap;
      container.append(el(tag, {}, renderWikiInline(heading[2])));
      continue;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (!list) list = el("ul");
      list.append(el("li", {}, renderWikiInline(bullet[1])));
      continue;
    }
    paragraph.push(trimmed);
  }

  if (inCode) flushCode();
  flushParagraph();
  flushList();
  if (!container.childElementCount) container.append(el("div", { class: "wiki-loading" }, "这个 wiki 文件暂无正文。"));
}

function renderWikiInline(text: string): Child[] {
  const out: Child[] = [];
  const pattern = /\[\[([^\]]+)\]\]/g;
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > lastIndex) out.push(localizeRelationTokens(text.slice(lastIndex, match.index)));
    const id = match[1].trim();
    out.push(wikiLabelResolver?.(id) || humanizeWikiId(id));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) out.push(localizeRelationTokens(text.slice(lastIndex)));
  return out.length ? out : [localizeRelationTokens(text)];
}

function humanizeWikiId(id: string): string {
  const tail = id.split("/").pop() || id;
  return tail.replace(/-/g, " ");
}

const relationTokenPattern = new RegExp(`(^|\\s)(${RELATION_TYPES.map(escapeRegExp).join("|")})(?=\\s|$)`, "g");

function localizeRelationTokens(text: string): string {
  return text.replace(relationTokenPattern, (_match, lead: string, relation: string) => `${lead}${relationCn(relation)}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadHistory(): HistoryItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") as Partial<HistoryItem>[];
    return parsed
      .filter((item): item is HistoryItem =>
        typeof item.query === "string" &&
        (item.mode === "path" || item.mode === "neighborhood") &&
        typeof item.nodeCount === "number" &&
        typeof item.t === "number",
      )
      .slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

function saveHistory(): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (error) {
    setStatus(`Failed to save local history: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

function closeWikiModal(): void {
  const modal = document.getElementById("wikiModal") as HTMLElement | null;
  if (modal) modal.hidden = true;
}

function modeCn(mode: Mode): string {
  return mode === "path" ? "路径" : "邻域";
}

function cleanMetaValue(value: unknown): string {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

function chipLine(items: string[]): HTMLElement {
  const wrap = el("div", { class: "chipline" });
  for (const item of items.length ? items : ["无"]) wrap.append(el("span", { class: "chip" }, item));
  return wrap;
}

function selectedRelationsFromButtons(root: HTMLElement): Set<string> {
  const selected = new Set<string>();
  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>("[data-relation]"))) {
    if (button.getAttribute("aria-pressed") === "true" && button.dataset.relation) selected.add(button.dataset.relation);
  }
  return selected;
}

function requiredEl<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  children?: Child,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) node.setAttribute(key, value);
  appendChildren(node, children);
  return node;
}

function appendChildren(node: Node, children: Child): void {
  if (Array.isArray(children)) {
    for (const child of children) appendChildren(node, child);
  } else if (children instanceof Node) {
    node.appendChild(children);
  } else if (children !== null && children !== undefined) {
    node.appendChild(document.createTextNode(String(children)));
  }
}
