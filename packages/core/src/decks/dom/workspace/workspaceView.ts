// The workspace's selection, drawing, modes, cursor and builds: what shows on the stage and panels, and how the text and the build state reach them.
import { renderElement } from "../../../ui/dom/index.js";
import {
  findSourceDeckNode, findSourceDeckPathAt, findSourceDeckPathAtLine, overflowingPosterBlocks, overfullSlides, spilledTypstSlides, readSourceDeckNotes, readSourceDeckShape,
  restoreSourceDeckPath, sourceDeckBreadcrumb, sourceDeckSpanAt, sourceDeckSpans, sourceDeckUnits, type SourceDeckNode, type SourceDeckPath, type SourceDeckRect,
} from "../../index.js";
import type { PdfDeck } from "../pdfDeck.js";
import type { SlideGrid } from "./slideGrid.js";
import type { StageOutline } from "./stage.js";
import type { DeckBuildState, DeckWorkspaceMode } from "./types.js";
import { loadIncludes, projectTree, textOf } from "./workspaceFiles.js";
import { codeFirst, selectedNode, slideIndex, unitPath, type WorkspaceState } from "./workspaceState.js";

/** The stage's note on how nodes are placed; a talk or poster edited in its code selects whole slides or blocks, so it has none. */
const stageNote = (ws: WorkspaceState): string => (codeFirst(ws) ? "" : ws.linking.note());

export function flash(ws: WorkspaceState, message: string): void {
  const { stage } = ws.ui;
  stage.setNote(message);
  clearTimeout(ws.flashTimer);
  ws.flashTimer = setTimeout(() => stage.setNote(stageNote(ws)), 4000);
}

/** The spans of the main file's slides (talk) or blocks (poster), as the code shows them one at a time. */
const spansOf = (ws: WorkspaceState): ReturnType<typeof sourceDeckSpans> => sourceDeckSpans(ws.format, ws.text, sourceDeckUnits(ws.kind, ws.tree));

/**
 * A talk or poster edited in its code: the editor shows only the selected slide's or block's lines (or the preamble's), and a cursor
 * outside them moves to the unit's start. An included file's slide leaves the editor as it is; it opens in its own file. Grid shows the whole file.
 */
function applyFocus(ws: WorkspaceState): void {
  const { editing } = ws.ports;
  if (!editing.focus) return;
  if (!codeFirst(ws)) { editing.focus(null); return; }
  // The text event of an edit has not arrived yet: the spans would be of the old text, so the next render focuses.
  if (ws.text !== editing.text()) return;
  const spans = spansOf(ws);
  const path = unitPath(ws);
  const unit = findSourceDeckNode(ws.tree, path);
  if (!ws.preamble && unit?.file !== undefined) return;
  const key = path.join(".");
  const span = !spans ? undefined : ws.preamble ? spans.preamble : spans.units.find((u) => u.path.join(".") === key)?.range;
  if (!span) { editing.focus(null); return; }
  if (ws.wholeFile) {
    // The whole file shows; a pick of another slide or block brings the cursor to it.
    editing.focus(null);
    const cursor = editing.cursor();
    if (cursor < span[0] || cursor > span[1]) { const at = ws.preamble ? 0 : unit?.range[0] ?? span[0]; editing.select(at, at); ws.echo = editing.cursor(); }
    return;
  }
  const before = editing.cursor();
  const after = editing.focus({ from: span[0], to: span[1] }, ws.preamble ? undefined : unit?.range[0]);
  if (after !== before) ws.echo = after;
}

/** In a talk's or poster's code, selects the slide or block (or the preamble) whose span holds the editor's offset; false when the file has none of its own. */
function selectSpanAt(ws: WorkspaceState, offset: number): boolean {
  const at = sourceDeckSpanAt(spansOf(ws), offset);
  if (at === undefined) return false;
  ws.preamble = at === "preamble";
  if (at !== "preamble") ws.selected = at;
  return true;
}

/** Shows the preamble in a talk's or poster's code. */
export function selectPreamble(ws: WorkspaceState): void {
  ws.preamble = true;
  render(ws);
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
  // A talk's slide or a poster's block shows through the editor's focus on it.
  if (codeFirst(ws)) return;
  ws.ports.editing.select(node.range[0], node.range[1]);
  ws.echo = ws.ports.editing.cursor();
}

/** Selects a node; a pick in the structure panel (`fromPanel`) also shows it in the source while Split follows. */
export function select(ws: WorkspaceState, path: SourceDeckPath, fromPanel = false): void {
  ws.selected = path;
  ws.preamble = false;
  if (fromPanel) followInSource(ws);
  render(ws);
}

/** What the view keeps per workspace between async calls: the last click, hover and outline draw, the last good outlines and the poster block under the pointer. */
interface ViewTickets { click: number; hover: number; draw: number; good: { selected: string; outlines: StageOutline[] } | undefined; hovered: SourceDeckPath | undefined }
const tickets = new WeakMap<WorkspaceState, ViewTickets>();
const ticketsOf = (ws: WorkspaceState): ViewTickets => {
  let known = tickets.get(ws);
  if (!known) { known = { click: 0, hover: 0, draw: 0, good: undefined, hovered: undefined }; tickets.set(ws, known); }
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
  if (codeFirst(ws) && ws.sync) { await pickUnit(ws, point, moot); return; }
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

/** The offset of the first non-blank character of 1-based `line`. */
function lineOffset(text: string, line: number): number {
  let at = 0;
  for (let n = 1; n < line && at !== -1; n++) at = text.indexOf("\n", at) + 1 || -1;
  if (at === -1) return text.length;
  return at + (/^[ \t]*/.exec(text.slice(at))?.[0].length ?? 0);
}

/**
 * A click on the page of a talk or poster edited in its code: selects the slide SyncTeX names (else the page's slide) or the poster block
 * under the point, and puts the cursor on SyncTeX's line when it is inside the unit's body, else on its first line. A click outside every
 * poster block does nothing. An included file's slide opens in its file instead.
 */
async function pickUnit(ws: WorkspaceState, point: { page: number; x: number; y: number }, moot: () => boolean): Promise<void> {
  const found = ws.ports.links ? await ws.ports.links.sourceAt(point).catch(() => null) : null;
  if (moot()) return;
  const hit = typeof found === "number" ? { line: found, file: undefined } : found ?? undefined;
  let path: SourceDeckPath;
  if (ws.kind === "talk") {
    const named = hit ? findSourceDeckPathAtLine(ws.tree, hit.line, (n) => n.file === hit.file)[0] : undefined;
    const slide = named !== undefined && ws.tree[named]?.kind === "slide" ? named : ws.linking.slideOfPage(point.page);
    path = slide === undefined ? [] : [slide];
  } else {
    path = await ws.linking.pathAt(point, ws.tree, (n) => n.kind === "block");
    if (moot()) return;
  }
  const node = findSourceDeckNode(ws.tree, path);
  if (!node || node.kind !== (ws.kind === "talk" ? "slide" : "block")) return;
  // SyncTeX tags a frame's content with the frame's last line, which says no more than the slide does.
  const line = hit && hit.file === node.file && hit.line > node.line && hit.line < node.endLine ? hit.line : undefined;
  ws.selected = path;
  ws.preamble = false;
  if (node.file !== undefined) { ws.ports.files?.open?.(node.file, line ?? node.line, { preserveFocus: true }); render(ws); return; }
  render(ws);
  const offset = line === undefined ? node.range[0] : lineOffset(ws.text, line);
  ws.ports.editing.reveal(offset);
  ws.echo = ws.ports.editing.cursor();
}

const holds = (rect: SourceDeckRect, point: { page: number; x: number; y: number }): boolean =>
  rect.page === point.page && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;

/**
 * The pointer moved over a poster's page (undefined: it left): the block under it, by the linking's rectangles, gets the hover outline.
 * Only the latest move draws.
 */
export async function hover(ws: WorkspaceState, point: { page: number; x: number; y: number } | undefined): Promise<void> {
  if (ws.kind !== "poster") return;
  const own = ticketsOf(ws);
  const move = ++own.hover;
  const { tree, linking } = ws;
  let best: { path: SourceDeckPath; area: number } | undefined;
  for (const { path } of point ? sourceDeckUnits("poster", tree) : []) {
    const rect = await linking.rectOf(path, tree, point!.page).catch(() => undefined);
    if (!rect || !holds(rect, point!)) continue;
    const area = (rect.right - rect.left) * (rect.bottom - rect.top);
    if (!best || area < best.area) best = { path, area };
  }
  if (own.hover !== move || ws.tree !== tree) return;
  if ((best?.path.join(".") ?? "") === (own.hovered?.join(".") ?? "")) return;
  own.hovered = best?.path;
  void drawOutlines(ws);
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
  const showSelection = selected.length > 0 && (ws.mode === "visual" || ws.sync) && !(kind === "talk" && (selected.length === 1 || codeFirst(ws))) && !(codeFirst(ws) && ws.preamble);
  let rect = showSelection ? await linking.rectOf(selected, tree, page) : undefined;
  // The poster block under the pointer, unless it is the selected one.
  const hovered = kind === "poster" && own.hovered && own.hovered.join(".") !== (showSelection ? selected.slice(0, 2).join(".") : "") ? await linking.rectOf(own.hovered, tree, page) : undefined;
  if (own.draw !== draw) return;
  if (hovered) outlines.push({ rect: hovered, tone: "hover" });
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
  stage.setNote(stageNote(ws));
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
    const where = codeFirst(ws) && ws.preamble ? `Preamble · ${slides} slides` : `Slide ${Math.min(index + 1, slides)} of ${slides}`;
    ws.ui.status.set({ left: `${where}${shape ? ` · ${shape}` : ""}`, crumb, nav: { previous: () => select(ws, [index - 1]), next: () => select(ws, [index + 1]), canPrevious: index > 0, canNext: index + 1 < slides } });
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
  const preamble = codeFirst(ws) && ws.preamble;
  structure.render(tree, preamble ? [] : selected, preamble);
  grids.get(ws)?.render(tree, selected);
  const node = selectedNode(ws);
  props.render(node, {
    index: selected.at(-1) ?? 0, ...(kind === "poster" && node?.kind === "block" ? { column: selected[0]! } : {}),
    source: node ? (node.file === undefined ? text : textOf(ws, node.file)).slice(node.range[0], node.range[1]) : "", linked: ws.linking.linked(), breadcrumb: sourceDeckBreadcrumb(tree, kind, selected).slice(1),
  });
  if (kind === "talk" && document.activeElement !== notes) notes.value = readSourceDeckNotes(ws.format, text)[slideIndex(ws)] ?? "";
  insertBar.refresh();
  renderStatus(ws);
  applyFocus(ws);
  void drawOutlines(ws);
}

/** A talk's slide list: a strip under the page in its code, which leaves the width to the code and the page; the left column elsewhere. */
function placeSlideList(ws: WorkspaceState): void {
  const list = ws.ui.structure.element;
  const column = ws.ui.stage.element.parentElement;
  const body = column?.parentElement;
  // A poster is one page: it has no strip, and its blocks are picked on the page or in the code.
  if (!column || !body || ws.kind === "poster") return;
  if (codeFirst(ws)) column.insertBefore(list, ws.ui.stage.element.nextSibling);
  else if (list.parentElement !== body) body.prepend(list);
}

/**
 * Sets the mode. Grid is Split with the slide grid in the preview's window in place of the page and the strip, the code staying beside it;
 * it is for talks only (a poster asked for it opens in Split) and selects the current slide as a whole. A poster selects a whole block.
 */
export function setMode(ws: WorkspaceState, requested: DeckWorkspaceMode): void {
  const grid = grids.get(ws);
  // Talks and posters have no Visual: they are edited in their code.
  ws.gridShown = requested === "grid" && grid !== undefined;
  const next = requested === "visual" || requested === "grid" ? "split" : requested;
  if (grid) grid.element.hidden = !ws.gridShown;
  ws.ui.root.dataset["grid"] = String(ws.gridShown);
  if (ws.gridShown) {
    const current = ws.tree[slideIndex(ws)]?.kind === "slide" ? slideIndex(ws) : ws.tree.findIndex((node) => node.kind === "slide");
    ws.selected = current < 0 ? [] : [current];
  }
  ws.mode = next;
  placeSlideList(ws);
  ws.ui.shell.setMode(next);
  ws.ui.header.setMode(next);
  ws.ports.mode.write(ws.gridShown ? "grid" : next);
  // The code shows the selected slide or block and brings the cursor to it.
  if (ws.kind === "poster") ws.selected = unitPath(ws);
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
  if (!codeFirst(ws) && (ws.mode !== "split" || (!ws.sync && !force))) return;
  if (codeFirst(ws)) {
    // The cursor event can come before the text event of the same edit.
    if (ws.text !== ws.ports.editing.text()) refreshText(ws);
    const was = `${ws.preamble}:${ws.selected.join()}`;
    if (selectSpanAt(ws, offset) && (force || `${ws.preamble}:${ws.selected.join()}` !== was)) render(ws);
    return;
  }
  // The cursor is in the main file: an included file's offsets never place it.
  const path = findSourceDeckPathAt(ws.tree, offset, (node) => node.file === undefined);
  if (path.join() === ws.selected.join() && !force) return;
  ws.selected = path;
  render(ws);
}

/** The host's editor moved the cursor in an included file (project-relative `path`, 1-based `line`): in Split with Sync on, its node is selected. */
export function fileCursorMoved(ws: WorkspaceState, path: string, line: number): void {
  if (!codeFirst(ws) && (ws.mode !== "split" || !ws.sync)) return;
  const found = findSourceDeckPathAtLine(ws.tree, line, (node) => node.file === path);
  const at = codeFirst(ws) ? found.slice(0, ws.kind === "talk" ? 1 : 2) : found;
  if (at.length === 0 || (at.join() === ws.selected.join() && !ws.preamble)) return;
  ws.selected = at;
  ws.preamble = false;
  render(ws);
}

/** The editor's text changed outside the workspace's own edits: reads it and keeps the selection by node path. */
export function textChanged(ws: WorkspaceState): void {
  if (ws.ownEdit) return;
  const before = selectedNode(ws);
  refreshText(ws);
  // In a talk's or poster's code the slide or block is the one being typed in.
  if (!(codeFirst(ws) && selectSpanAt(ws, ws.ports.editing.cursor()))) ws.selected = restoreSourceDeckPath(ws.tree, ws.selected, before);
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
  structure.setPdf(stage.pdf());
  grids.get(ws)?.setPdf(stage.pdf());
  stage.setNote(stageNote(ws));
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
}

/** Opens the first PDF after the workspace is mounted. */
export function loadFirst(ws: WorkspaceState): void { followIncludes(ws); void reload(ws); }
