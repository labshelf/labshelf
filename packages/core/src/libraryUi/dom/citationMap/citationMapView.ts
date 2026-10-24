// Shows the citation map in place of the paper list while the host has one open: its graph, then the missing works.

import { icon } from "../../../ui/index.js";
import type { CitationMapState, CitationMapView } from "../../protocol/index.js";
import type { UiContext } from "../uiContext.js";
import { citationGraphSvg } from "./citationGraphSvg.js";
import { emptyMarkup, failedMarkup, loadingMarkup } from "./citationMapStates.js";
import { markImporting, missingWorkList } from "./missingWorkList.js";

const HIGHLIGHT_MS = 1600;

const headerHtml = `
  <button class="crumb" type="button" data-act="back" title="Back to the paper list">${icon("arrow-left")}<span>Papers</span></button>
  <h2 class="cm-title-bar">Citation map</h2>
  <span class="tb-spacer"></span>
  <button class="ls-icon-btn" type="button" data-act="refresh" title="Look the citations up again">${icon("refresh")}</button>`;

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
