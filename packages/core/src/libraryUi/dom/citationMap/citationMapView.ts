// Shows the citation map in place of the paper list while the host has one open: its graph, then the missing works.

import { renderIcon, escapeHtml } from "../../../ui/index.js";
import type { CitationMapState, CitationMapView } from "../../protocol/index.js";
import type { UiContext } from "../uiContext.js";
import { GRAPH_MAX_RADIUS, createCitationMapGraph, deriveForceLayout, type GraphNode, type Point } from "../../citationMap/index.js";
import type { MissingWork } from "../../../import/index.js";

const SHOWN_AUTHORS = 3;
const NO_DOI_TIP = "This work has no DOI, so LabShelf cannot import it";

/** "Ada Lovelace, Alan Turing, Grace Hopper et al. · 1950" */
function byline(work: MissingWork): string {
  const names = work.authors.slice(0, SHOWN_AUTHORS).join(", ") + (work.authors.length > SHOWN_AUTHORS ? " et al." : "");
  return [names, work.year].filter(Boolean).join(" · ");
}

function importButton(work: MissingWork): string {
  if (!work.doi) {
    return `<span class="cm-import-wrap" title="${NO_DOI_TIP}"><button class="ls-btn cm-import" type="button" disabled>Import</button></span>`;
  }
  return `<button class="ls-btn cm-import" type="button" data-act="import" data-work="${escapeHtml(work.workId)}" data-doi="${escapeHtml(work.doi)}" title="Import this paper into your library">Import</button>`;
}

function citedBy(work: MissingWork, titles: ReadonlyMap<string, string>, expanded: boolean): string {
  const items = work.citedBy.map((id) =>
    `<li><button class="cm-paper-link" type="button" data-act="open" data-id="${escapeHtml(id)}">${escapeHtml(titles.get(id) ?? id)}</button></li>`);
  return `<details class="cm-cited"${expanded ? " open" : ""}><summary>Cited by ${work.citedBy.length} of your papers</summary>` +
    `<ul>${items.join("")}</ul></details>`;
}

function rowMarkup(work: MissingWork, titles: ReadonlyMap<string, string>, expanded: boolean): string {
  const meta = byline(work);
  return `<li class="cm-row" data-work="${escapeHtml(work.workId)}" tabindex="-1"><div class="cm-row-text">` +
    `<div class="cm-title">${escapeHtml(work.title)}</div>` +
    (meta ? `<div class="cm-meta">${escapeHtml(meta)}</div>` : "") +
    `${citedBy(work, titles, expanded)}</div>${importButton(work)}</li>`;
}

/** Builds the list's markup; `open` names the works whose "Cited by" stays expanded across a repaint. */
function missingWorkList(map: CitationMapView, open: ReadonlySet<string>): string {
  const titles = new Map(map.papers.map((p) => [p.id, p.title]));
  const html = map.missing.map((w) => rowMarkup(w, titles, open.has(w.workId))).join("");
  return `<ul class="cm-list" aria-label="Often cited by your papers, not in your library">${html}</ul>`;
}

/** Shows each Import button as busy while its work is being imported. */
function markImporting(list: ParentNode, importing: ReadonlySet<string>): void {
  for (const btn of list.querySelectorAll<HTMLButtonElement>('button[data-act="import"]')) {
    const busy = importing.has(btn.dataset["work"] ?? "");
    if (busy === (btn.getAttribute("aria-busy") === "true")) continue;
    btn.disabled = busy;
    btn.setAttribute("aria-busy", String(busy));
    btn.innerHTML = busy ? `<span class="spin">${renderIcon("loader")}</span><span>Importing…</span>` : "Import";
  }
}

const BOX = { width: 640, height: 360, padding: GRAPH_MAX_RADIUS + 2 };

const round = (n: number): string => n.toFixed(1);

function nodeTitle(node: GraphNode, citing: number): string {
  return node.kind === "paper" ? node.title : `${node.title} (cited by ${citing} of your papers, not in your library)`;
}

function nodeMarkup(node: GraphNode, at: Point, citing: number): string {
  const act = node.kind === "paper" ? "open" : "show-work";
  const ref = node.kind === "paper" ? `data-id="${escapeHtml(node.ref)}"` : `data-work="${escapeHtml(node.ref)}"`;
  return `<circle class="cm-node cm-node-${node.kind}" cx="${round(at.x)}" cy="${round(at.y)}" r="${round(node.radius)}" data-act="${act}" ${ref}>` +
    `<title>${escapeHtml(nodeTitle(node, citing))}</title></circle>`;
}

/**
 * Builds the graph's SVG markup, or an empty string when there is nothing to connect.
 * The list beside it carries every action, so the picture is a mouse shortcut, hidden from assistive technology as one image.
 */
function citationGraphSvg(map: CitationMapView): string {
  const graph = createCitationMapGraph(map);
  if (graph.edges.length === 0) return "";
  const index = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const pairs = graph.edges.map((e) => [index.get(e.from)!, index.get(e.to)!] as const);
  const at = deriveForceLayout(graph.nodes.length, pairs, BOX);
  const citing = new Map(map.missing.map((w) => [w.workId, w.citedBy.length]));
  const edges = pairs.map(([a, b]) => {
    const kind = graph.nodes[b]!.kind === "missing" ? " cm-edge-missing" : "";
    return `<line class="cm-edge${kind}" x1="${round(at[a]!.x)}" y1="${round(at[a]!.y)}" x2="${round(at[b]!.x)}" y2="${round(at[b]!.y)}"/>`;
  });
  const nodes = graph.nodes.map((n, i) => nodeMarkup(n, at[i]!, citing.get(n.ref) ?? 0));
  const label = `Citation graph of ${map.papers.length} of your papers and ${map.missing.length} works not in your library`;
  return `<svg class="cm-graph" viewBox="0 0 ${BOX.width} ${BOX.height}" role="img" aria-label="${escapeHtml(label)}">` +
    `<g class="cm-edges">${edges.join("")}</g><g class="cm-nodes">${nodes.join("")}</g></svg>`;
}

function loadingMarkup(): string {
  return `<div class="list-loading"><span class="spin">${renderIcon("loader")}</span> Looking up what your papers cite…</div>`;
}

function failedMarkup(message: string): string {
  return `<div class="ls-empty"><div class="ls-empty-icon">${renderIcon("warning")}</div>` +
    `<div class="ls-empty-text">The citation map could not be built</div>` +
    `<div class="ls-empty-hint">${escapeHtml(message)}</div>` +
    `<button class="ls-btn" type="button" data-act="refresh">${renderIcon("refresh")}<span>Try again</span></button></div>`;
}

function emptyMarkup(): string {
  return `<div class="ls-empty"><div class="ls-empty-icon">${renderIcon("link")}</div>` +
    `<div class="ls-empty-text">No often-cited works are missing from your library</div>` +
    `<div class="ls-empty-hint">Works cited by at least 3 of your papers appear here. Only papers with a DOI are looked up, ` +
    `so add DOIs to papers that lack one.</div></div>`;
}

const HIGHLIGHT_MS = 1600;

const headerHtml = `
  <button class="crumb" type="button" data-act="back" title="Back to the paper list">${renderIcon("arrow-left")}<span>Papers</span></button>
  <h2 class="cm-title-bar">Citation map</h2>
  <span class="tb-spacer"></span>
  <button class="ls-icon-btn" type="button" data-act="refresh" title="Look the citations up again">${renderIcon("refresh")}</button>`;

function readyMarkup(map: CitationMapView, graph: string, open: ReadonlySet<string>): string {
  const list = map.missing.length ? missingWorkList(map, open) : emptyMarkup();
  return (graph ? `<div class="cm-graph-wrap">${graph}</div>` : "") +
    `<h3 class="cm-heading">Often cited by your papers, not in your library</h3>${list}`;
}

// The row a graph node stands for comes into view and flashes, and takes focus so its buttons are a Tab away.
function showWork(body: HTMLElement, workId: string): void {
  const row = [...body.querySelectorAll<HTMLElement>(".cm-row")].find((r) => r.dataset["work"] === workId);
  if (!row) return;
  row.scrollIntoView({ block: "nearest" });
  row.focus({ preventScroll: true });
  row.classList.add("highlighted");
  setTimeout(() => row.classList.remove("highlighted"), HIGHLIGHT_MS);
}

function onAction(ctx: UiContext, body: HTMLElement, target: HTMLElement): void {
  const { act, id, work, doi } = target.dataset;
  switch (act) {
    case "back": ctx.store.showCitationMap(null); ctx.focusList(); return;
    case "refresh":
      ctx.store.showCitationMap({ status: "loading" });
      ctx.transport.post({ type: "citationMap.refresh" });
      return;
    case "import":
      if (!work || !doi) return;
      ctx.store.setCitationImporting(work, true);
      ctx.transport.post({ type: "citationMap.import", workId: work, doi });
      return;
    case "open": if (id) ctx.transport.post({ type: "paper.open", id }); return;
    case "show-work": if (work) showWork(body, work); return;
  }
}

/** Mounts the citation map into its frame slot and returns its unsubscribe function. */
export function mountCitationMap(ctx: UiContext, container: HTMLElement): () => void {
  const header = document.createElement("div");
  header.className = "list-header cm-header";
  header.innerHTML = headerHtml;
  const body = document.createElement("div");
  body.className = "cm-body";
  container.append(header, body);
  container.addEventListener("click", (e) => {
    // SVG nodes carry their action as attributes too, and `closest` crosses from SVG into HTML.
    const target = (e.target as Element).closest<HTMLElement>("[data-act]");
    if (target && container.contains(target)) onAction(ctx, body, target);
  });
  let graphOf: CitationMapView | null = null;
  let graph = "";
  const render = (state: CitationMapState | null): void => {
    ctx.root.classList.toggle("citation-map-open", state !== null);
    container.hidden = state === null;
    if (state?.status !== "ready") {
      body.innerHTML = !state ? "" : state.status === "loading" ? loadingMarkup() : failedMarkup(state.message);
      return;
    }
    if (graphOf !== state.map) { graphOf = state.map; graph = citationGraphSvg(state.map); }
    const open = new Set([...body.querySelectorAll("details[open]")].map((d) => d.closest<HTMLElement>(".cm-row")?.dataset["work"] ?? ""));
    body.innerHTML = readyMarkup(state.map, graph, open);
    markImporting(body, ctx.store.get().citationImporting);
  };
  const offs = [
    ctx.store.select((s) => s.citationMap, render),
    ctx.store.select((s) => s.citationImporting, (importing) => markImporting(body, importing)),
  ];
  return () => offs.forEach((off) => off());
}
