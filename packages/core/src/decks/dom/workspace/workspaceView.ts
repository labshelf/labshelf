// The workspace's selection, drawing, modes, cursor and builds: what shows on the stage and panels, and how the text and the build state reach them.
import { renderElement } from "../../../ui/dom/index.js";
import { findSourceDeckPathAt, findSourceDeckPathAtLine, overflowingPosterBlocks, overfullSlides, spilledTypstSlides, readSourceDeckNotes, readSourceDeckShape, restoreSourceDeckPath, sourceDeckBreadcrumb, type SourceDeckNode, type SourceDeckPath } from "../../index.js";
import type { PdfDeck } from "../pdfDeck.js";
import type { SlideGrid } from "./slideGrid.js";
import type { StageOutline } from "./stage.js";
import type { DeckBuildState, DeckWorkspaceMode } from "./types.js";
import { loadIncludes, projectTree, textOf } from "./workspaceFiles.js";
import { selectedNode, slideIndex, type WorkspaceState } from "./workspaceState.js";

export function flash(ws: WorkspaceState, message: string): void {
  const { stage } = ws.ui;
  stage.setNote(message);
  clearTimeout(ws.flashTimer);
  ws.flashTimer = setTimeout(() => stage.setNote(ws.linking.note()), 4000);
}

/**
 * In Split with Sync on, shows the selected node in the source: a main-file node's range is selected in the editor (its cursor is kept as
 * the echo to ignore), an included file's node opens at its line beside, without taking the focus.
 */
function followInSource(ws: WorkspaceState): void {
  if (ws.mode !== "split" || !ws.sync) return;
  const node = selectedNode(ws);
  if (!node) return;
  if (node.file !== undefined) { ws.ports.files?.open?.(node.file, node.line, { preserveFocus: true }); return; }
  ws.ports.editing.select(node.range[0], node.range[1]);
  ws.echo = ws.ports.editing.cursor();
}

/** Selects a node; a pick in the structure panel (`fromPanel`) also shows it in the source while Split follows. */
export function select(ws: WorkspaceState, path: SourceDeckPath, fromPanel = false): void {
  ws.selected = path;
  if (fromPanel) followInSource(ws);
  render(ws);
}

/** What the view keeps per workspace between async calls: the last click, the last outline draw and the last good outlines. */
interface ViewTickets { click: number; draw: number; good: { selected: string; outlines: StageOutline[] } | undefined }
const tickets = new WeakMap<WorkspaceState, ViewTickets>();
const ticketsOf = (ws: WorkspaceState): ViewTickets => {
  let known = tickets.get(ws);
  if (!known) { known = { click: 0, draw: 0, good: undefined }; tickets.set(ws, known); }
  return known;
};

/** What drops a cursor move still waiting for its debounce, per workspace: a newer stage click wins over it. */
const cursorCancels = new WeakMap<WorkspaceState, () => void>();
export function attachCursor(ws: WorkspaceState, cancel: () => void): void { cursorCancels.set(ws, cancel); }

/** A click on the page: the block under it, or (when that block is already selected) the element inside it. The last click wins. */
export async function pick(ws: WorkspaceState, point: { page: number; x: number; y: number }): Promise<void> {
  const own = ticketsOf(ws);
  const click = ++own.click;
  // A cursor move still waiting for its debounce is older than this click: it must not undo the click's selection.
  cursorCancels.get(ws)?.();
  const { kind, linking, tree } = ws;
  // A later click, or an edit that replaced the tree the answer's path is in, makes this click's answer moot.
  const moot = (): boolean => own.click !== click || ws.tree !== tree;
  const container = kind === "talk" ? (n: SourceDeckNode) => n.kind !== "slide" : (n: SourceDeckNode) => n.kind === "block";
  let path = await linking.pathAt(point, tree, kind === "talk" ? () => true : container);
  if (moot()) return;
  const { selected } = ws;
  if (kind === "poster" && path.length >= 2 && selected.length >= 2 && path[0] === selected[0] && path[1] === selected[1]) {
    const inner = await linking.pathAt(point, tree, () => true);
    if (moot()) return;
    if (inner.length > 2) path = inner;
  }
  if (kind === "talk" && path.length === 0) path = [linking.slideOfPage(point.page) ?? slideIndex(ws)];
  if (kind === "poster" && path.length === 0) path = ws.selected.slice(0, 1);
  select(ws, path, true);
}

/**
 * Outlines the selection (and the blocks while Guides is on). Only the latest call draws. While a build runs or after one failed, a selection
 * the linking cannot place keeps the last good outlines, drawn stale, until the rebuilt rectangles arrive.
 */
export async function drawOutlines(ws: WorkspaceState): Promise<void> {
  const own = ticketsOf(ws);
  const draw = ++own.draw;
  const { kind, linking, tree, selected } = ws;
  const { stage } = ws.ui;
  const outlines: StageOutline[] = [];
  const page = kind === "talk" ? linking.pageOfSlide(slideIndex(ws)) : 1;
  if (page !== undefined) stage.showPage(page);
  if (stage.guides()) {
    const containers = kind === "talk" ? (tree[slideIndex(ws)]?.children ?? []).map((_, i) => [slideIndex(ws), i]) : tree.flatMap((column, c) => (column.children ?? []).map((_, b) => [c, b]));
    for (const path of containers) { const rect = await linking.rectOf(path, tree, page); if (rect) outlines.push({ rect, tone: "guide" }); }
  }
  // A poster's overflowing blocks, as the last loaded build marks them.
  for (const key of kind === "poster" ? ws.posterOverflow ?? [] : []) {
    const rect = await linking.rectOf(key.split(".").map(Number), tree, page);
    if (rect) outlines.push({ rect, tone: "overflow" });
  }
  const showSelection = selected.length > 0 && (ws.mode === "visual" || ws.sync) && !(kind === "talk" && selected.length === 1);
  let rect = showSelection ? await linking.rectOf(selected, tree, page) : undefined;
  if (own.draw !== draw) return;
  if (rect) outlines.push({ rect, tone: "selected" });
  let drawn: readonly StageOutline[] = outlines;
  const stale = ws.build.state === "building" || ws.build.state === "failed";
  const key = selected.join(".");
  if (!stale && rect) own.good = { selected: key, outlines };
  else if (stale && showSelection && !rect && own.good?.selected === key) {
    drawn = own.good.outlines.map((outline) => (outline.tone === "selected" ? { ...outline, tone: "stale" } : outline));
    rect = own.good.outlines.find((outline) => outline.tone === "selected")?.rect;
  }
  stage.setOutlines(drawn);
  stage.placeBar(ws.ui.actionBar, ws.mode === "visual" ? rect : undefined);
  // Asking for a rectangle tells whether SyncTeX places the nodes; the note says when it does not.
  stage.setNote(linking.note());
  ws.ui.poster?.refresh();
}

function renderStatus(ws: WorkspaceState): void {
  const { kind, format, tree, selected } = ws;
  const crumb = sourceDeckBreadcrumb(tree, kind, selected);
  const shape = readSourceDeckShape(format, kind, ws.text) ?? "";
  const pdf = ws.ui.stage.pdf();
  if (kind === "talk") {
    const slides = tree.filter((n) => n.kind === "slide").length;
    const index = slideIndex(ws);
    ws.ui.status.set({ left: `Slide ${Math.min(index + 1, slides)} of ${slides}${shape ? ` · ${shape}` : ""}`, crumb, nav: { previous: () => select(ws, [index - 1]), next: () => select(ws, [index + 1]), canPrevious: index > 0, canNext: index + 1 < slides } });
    return;
  }
  const size = pdf?.pageSize(0);
  const mm = size ? ` · ${Math.round((size.width / 72) * 25.4)} × ${Math.round((size.height / 72) * 25.4)} mm` : "";
  ws.ui.status.set({ left: `Poster${shape ? ` · ${shape}` : ""}${mm}${ws.posterWarning ? ` · ${ws.posterWarning}` : ""}`, crumb });
}

/** The slide grid of each talk workspace; a poster has none. */
const grids = new WeakMap<WorkspaceState, SlideGrid>();
export function attachGrid(ws: WorkspaceState, grid: SlideGrid): void { grids.set(ws, grid); }

export function render(ws: WorkspaceState): void {
  const { kind, tree, selected, text } = ws;
  const { structure, props, notes, insertBar } = ws.ui;
  structure.render(tree, selected);
  grids.get(ws)?.render(tree, selected);
  const node = selectedNode(ws);
  props.render(node, {
    index: selected.at(-1) ?? 0, ...(kind === "poster" && node?.kind === "block" ? { column: selected[0]! } : {}),
    source: node ? (node.file === undefined ? text : textOf(ws, node.file)).slice(node.range[0], node.range[1]) : "", linked: ws.linking.linked(), breadcrumb: sourceDeckBreadcrumb(tree, kind, selected).slice(1),
  });
  if (kind === "talk" && document.activeElement !== notes) notes.value = readSourceDeckNotes(ws.format, text)[slideIndex(ws)] ?? "";
  insertBar.refresh();
  renderStatus(ws);
  void drawOutlines(ws);
}

/** Sets the mode; Grid is for talks only (a poster asked for it opens in Visual) and selects the current slide as a whole. */
export function setMode(ws: WorkspaceState, requested: DeckWorkspaceMode): void {
  const grid = grids.get(ws);
  const next = requested === "grid" && !grid ? "visual" : requested;
  if (grid) grid.element.hidden = next !== "grid";
  if (next === "grid") {
    const current = ws.tree[slideIndex(ws)]?.kind === "slide" ? slideIndex(ws) : ws.tree.findIndex((node) => node.kind === "slide");
    ws.selected = current < 0 ? [] : [current];
  }
  ws.mode = next;
  ws.ui.shell.setMode(next);
  ws.ui.header.setMode(next);
  ws.ports.mode.write(next);
  if (next === "split") cursorMoved(ws, ws.ports.editing.cursor(), true);
  render(ws);
}

/** Builds the tree again from the main text and the cached included files: the rectangles found for the old one start over. */
export function refreshTree(ws: WorkspaceState): void {
  ws.tree = projectTree(ws);
  ws.linking.forget();
}

/** Reads includes not cached yet; when any arrives the tree is built again, keeping the selection by node. */
function followIncludes(ws: WorkspaceState): void {
  void loadIncludes(ws, () => {
    const before = selectedNode(ws);
    refreshTree(ws);
    ws.selected = restoreSourceDeckPath(ws.tree, ws.selected, before);
    render(ws);
  });
}

/** Reads the editor's text again: the tree, and the rectangles found for it, start over; new includes are read in the background. */
export function refreshText(ws: WorkspaceState): void {
  ws.text = ws.ports.editing.text();
  refreshTree(ws);
  followIncludes(ws);
}

/** The editor's cursor moved: in Split with Sync on (or when forced) the node under it is selected. The echo of the workspace's own select is skipped once. */
export function cursorMoved(ws: WorkspaceState, offset: number, force = false): void {
  if (!force && ws.echo !== undefined) {
    const echoed = ws.echo === offset;
    ws.echo = undefined;
    if (echoed) return;
  }
  if (ws.mode !== "split" || (!ws.sync && !force)) return;
  // The cursor is in the main file: an included file's offsets never place it.
  const path = findSourceDeckPathAt(ws.tree, offset, (node) => node.file === undefined);
  if (path.join() === ws.selected.join() && !force) return;
  ws.selected = path;
  render(ws);
}

/** The host's editor moved the cursor in an included file (project-relative `path`, 1-based `line`): in Split with Sync on, its node is selected. */
export function fileCursorMoved(ws: WorkspaceState, path: string, line: number): void {
  if (ws.mode !== "split" || !ws.sync) return;
  const found = findSourceDeckPathAtLine(ws.tree, line, (node) => node.file === path);
  if (found.length === 0 || found.join() === ws.selected.join()) return;
  ws.selected = found;
  render(ws);
}

/** The editor's text changed outside the workspace's own edits: reads it and keeps the selection by node path. */
export function textChanged(ws: WorkspaceState): void {
  if (ws.ownEdit) return;
  const before = selectedNode(ws);
  refreshText(ws);
  ws.selected = restoreSourceDeckPath(ws.tree, ws.selected, before);
  render(ws);
}

const emptyStage = (ws: WorkspaceState): HTMLElement => {
  const building = ws.build.state === "building";
  const button = renderElement("button", { type: "button", class: "dw-button", text: "Build" });
  button.addEventListener("click", () => ws.ports.build.run());
  return renderElement("div", { class: "dw-empty-card" }, renderElement("p", { text: building ? "Compiling the PDF…" : "No PDF yet. Build the file to see it here." }), ...(building ? [] : [button]));
};

/** The talk slides the loaded PDF's build marks as overflowing: LaTeX by the lines of its Overfull \\vbox warnings, Typst by spilled pages. */
async function findOverflow(ws: WorkspaceState, pdf: PdfDeck): Promise<Set<number>> {
  if (ws.format === "latex") return overfullSlides(ws.tree, ws.build.overflow ?? [], ws.ports.path);
  const pages = await Promise.all(Array.from({ length: pdf.count }, (_, page) => pdf.textRuns(page).then((runs) => runs.map((run) => run.text).join(" "), () => "")));
  return spilledTypstSlides(ws.tree, (file) => textOf(ws, file), pages);
}

async function reload(ws: WorkspaceState): Promise<void> {
  const { stage, structure } = ws.ui;
  const loaded = await stage.load().catch(() => false);
  stage.setEmpty(loaded ? null : emptyStage(ws));
  await ws.linking.reset(stage.pdf(), ws.tree, ws.text);
  // A failed build keeps the badges of the last good one; posters get none (their print check is separate).
  const pdf = stage.pdf();
  if (loaded && pdf && ws.kind === "talk" && ws.build.state !== "failed") ws.overflow = await findOverflow(ws, pdf);
  if (loaded && pdf && ws.ui.poster && ws.build.state !== "failed") posterOverflow(ws, pdf);
  ws.ui.poster?.loaded();
  structure.setPdf(stage.pdf());
  grids.get(ws)?.setPdf(stage.pdf());
  stage.setNote(ws.linking.note());
  render(ws);
}

/** The poster blocks the loaded build marks as overflowing; the first build after an orientation switch warns when any does. */
function posterOverflow(ws: WorkspaceState, pdf: PdfDeck): void {
  ws.posterOverflow = new Set(overflowingPosterBlocks(ws.tree, ws.build.overflow ?? [], ws.ports.path, pdf.count));
  if (ws.build.state !== "succeeded") return;
  ws.posterWarning = ws.posterTurned && ws.posterOverflow.size > 0 ? "Some blocks overflow after the orientation change" : undefined;
  ws.posterTurned = false;
}

/** A build state arrived: shows it in the header and loads the PDF after a successful build. */
export function buildStateChanged(ws: WorkspaceState, next: DeckBuildState): void {
  const { stage } = ws.ui;
  const finished = ws.build.state === "building" && next.state !== "building";
  ws.build = next;
  ws.ui.header.setBuild(next);
  if (next.state === "succeeded" && (finished || !stage.pdf())) void reload(ws);
  else if (!stage.pdf()) stage.setEmpty(emptyStage(ws));
  // The outlines turn stale while the build runs and after it failed.
  if (next.state === "building" || next.state === "failed") void drawOutlines(ws);
  // The poster's stage controls are offered only on a fresh build.
  else ws.ui.poster?.refresh();
}

/** Opens the first PDF after the workspace is mounted. */
export function loadFirst(ws: WorkspaceState): void { followIncludes(ws); void reload(ws); }
