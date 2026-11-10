// The workspace's selection, drawing, modes, cursor and builds: what shows on the stage and panels, and how the text and the build state reach them.
import { renderElement } from "../../../ui/dom/index.js";
import {
  findSourceDeckNode, findSourceDeckPathAt, findSourceDeckPathAtLine, overflowingPosterBlocks, overfullSlides, spilledTypstSlides, readSourceDeckNotes, readSourceDeckShape,
  readableSourceTitle, restoreSourceDeckPath, sourceDeckBreadcrumb, sourceDeckSpanAt, sourceDeckSpans, sourceDeckUnits, type SourceDeckPath, type SourceDeckRange,
} from "../../index.js";
import { deriveLineOffsets } from "../../../text/lines.js";
import type { PdfDeck } from "../pdfDeck.js";
import type { PageSection } from "./linking.js";
import type { SlideGrid, StripUnit } from "./slideGrid.js";
import type { StageOutline } from "./stage.js";
import type { DeckBuildState, DeckWorkspaceMode } from "./types.js";
import { loadIncludes, projectTree, textOf } from "./workspaceFiles.js";
import { codeFirst, selectedNode, slideIndex, unitPath, type WorkspaceState } from "./workspaceState.js";

export function flash(ws: WorkspaceState, message: string): void {
  const { stage } = ws.ui;
  stage.setNote(message);
  clearTimeout(ws.flashTimer);
  ws.flashTimer = setTimeout(() => stage.setNote(""), 4000);
}

/** The spans of the main file's slides (talk) or blocks (poster), as the code shows them one at a time. */
const spansOf = (ws: WorkspaceState): ReturnType<typeof sourceDeckSpans> => sourceDeckSpans(ws.format, ws.text, sourceDeckUnits(ws.kind, ws.tree));

/** The whole line of a main-file section command, as the code shows a section divider. */
function sectionSpan(ws: WorkspaceState, section: PageSection): SourceDeckRange | undefined {
  const starts = deriveLineOffsets(ws.text);
  const from = starts[section.line - 1];
  return from === undefined ? undefined : [from, (starts[section.line] ?? ws.text.length + 1) - 1];
}

/**
 * The lines the code shows and where a cursor outside them goes: the selected section command, the preamble, or the selected slide's or
 * block's span; "elsewhere" when it is in an included file, which opens in its own editor.
 */
function focusTarget(ws: WorkspaceState): { span: SourceDeckRange; at: number } | "elsewhere" | undefined {
  if (ws.section) {
    if (ws.section.file !== undefined) return "elsewhere";
    const span = sectionSpan(ws, ws.section);
    return span && { span, at: span[0] };
  }
  const spans = spansOf(ws);
  const path = unitPath(ws);
  const unit = findSourceDeckNode(ws.tree, path);
  if (!ws.preamble && unit?.file !== undefined) return "elsewhere";
  if (!spans) return undefined;
  if (ws.preamble) return { span: spans.preamble, at: 0 };
  const key = path.join(".");
  const span = spans.units.find((u) => u.path.join(".") === key)?.range;
  return span && { span, at: unit?.range[0] ?? span[0] };
}

/**
 * A talk or poster edited in its code: the editor shows only the selected section's, slide's or block's lines (or the preamble's), and a
 * cursor outside them moves to the unit's start. With File the whole file shows and a pick brings the cursor to the unit. Grid shows the whole file.
 */
function applyFocus(ws: WorkspaceState): void {
  const { editing } = ws.ports;
  if (!editing.focus) return;
  if (!codeFirst(ws)) { editing.focus(null); return; }
  // The text event of an edit has not arrived yet: the spans would be of the old text, so the next render focuses.
  if (ws.text !== editing.text()) return;
  const target = focusTarget(ws);
  if (target === "elsewhere") return;
  if (!target) { editing.focus(null); return; }
  const { span: [from, to], at } = target;
  if (ws.wholeFile) {
    editing.focus(null);
    const cursor = editing.cursor();
    if (cursor < from || cursor > to) { editing.select(at, at); ws.echo = editing.cursor(); }
    return;
  }
  const before = editing.cursor();
  const after = editing.focus({ from, to }, at);
  if (after !== before) ws.echo = after;
}

/**
 * In a talk's or poster's code, selects the slide or block (or the preamble) whose span holds the editor's offset; a cursor on the selected
 * section command keeps it. False when the file has no unit of its own.
 */
function selectSpanAt(ws: WorkspaceState, offset: number): boolean {
  const section = ws.section && sectionSpan(ws, ws.section);
  if (section && offset >= section[0] && offset <= section[1]) return true;
  const at = sourceDeckSpanAt(spansOf(ws), offset);
  if (at === undefined) return false;
  ws.section = undefined;
  ws.preamble = at === "preamble";
  if (at !== "preamble") ws.selected = at;
  return true;
}

/** Shows the preamble in a talk's or poster's code. */
export function selectPreamble(ws: WorkspaceState): void {
  ws.preamble = true;
  ws.section = undefined;
  render(ws);
}

/** Shows a section divider: its page, and its command in the code (an included file's opens in its own editor at the line). */
export function selectSection(ws: WorkspaceState, section: PageSection): void {
  ws.section = section;
  ws.preamble = false;
  if (section.file !== undefined) ws.ports.files?.open?.(section.file, section.line, { preserveFocus: true });
  render(ws);
}

/** A section command's title, from its line: the argument in braces, as it reads on the slide. */
function sectionTitle(ws: WorkspaceState, section: PageSection): string {
  const text = section.file === undefined ? ws.text : textOf(ws, section.file);
  const line = text.split("\n")[section.line - 1] ?? "";
  const title = /\\(?:sub)*section\*?\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(line)?.[1];
  return title === undefined ? "Section" : readableSourceTitle(title);
}

/** What a talk's strip and grid list: the slides and the section dividers the build shipped between them, in page order. */
export function stripUnits(ws: WorkspaceState): StripUnit[] {
  return ws.linking.units().map((unit) => (unit.kind === "slide" ? unit : {
    kind: "section", section: unit.file === undefined ? { line: unit.line } : { file: unit.file, line: unit.line }, page: unit.page,
    title: sectionTitle(ws, unit), selected: ws.section !== undefined && ws.section.line === unit.line && ws.section.file === unit.file,
  }));
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
  ws.section = undefined;
  if (fromPanel) followInSource(ws);
  render(ws);
}

/** What the view keeps per workspace between draws: the last good outlines and the poster block under the pointer. */
interface ViewTickets { good: { selected: string; outlines: StageOutline[] } | undefined; hovered: SourceDeckPath | undefined }
const tickets = new WeakMap<WorkspaceState, ViewTickets>();
const ticketsOf = (ws: WorkspaceState): ViewTickets => {
  let known = tickets.get(ws);
  if (!known) { known = { good: undefined, hovered: undefined }; tickets.set(ws, known); }
  return known;
};

/** What drops a cursor move still waiting for its debounce, per workspace: a newer stage click wins over it. */
const cursorCancels = new WeakMap<WorkspaceState, () => void>();
export function attachCursor(ws: WorkspaceState, cancel: () => void): void { cursorCancels.set(ws, cancel); }

/**
 * A click on the page selects what the build's page map says shipped it: a talk's slide or section divider, or the poster block under the
 * point, with the cursor at its start (an included file's opens in its file). A page or point the map does not link selects nothing.
 */
export function pick(ws: WorkspaceState, point: { page: number; x: number; y: number }): void {
  // A cursor move still waiting for its debounce is older than this click: it must not undo the click's selection.
  cursorCancels.get(ws)?.();
  const { linking } = ws;
  if (ws.kind === "talk") {
    const section = linking.sectionOfPage(point.page);
    if (section) { selectSection(ws, section); return; }
  }
  const slide = ws.kind === "talk" ? linking.slideOfPage(point.page) : undefined;
  const path = ws.kind === "talk" ? (slide === undefined ? [] : [slide]) : linking.blockAt(point);
  const node = findSourceDeckNode(ws.tree, path);
  if (!node || path.length === 0) return;
  ws.selected = path;
  ws.preamble = false;
  ws.section = undefined;
  if (node.file !== undefined) { ws.ports.files?.open?.(node.file, node.line, { preserveFocus: true }); render(ws); return; }
  render(ws);
  ws.ports.editing.reveal(node.range[0]);
  ws.echo = ws.ports.editing.cursor();
}

/** The pointer moved over a poster's page (undefined: it left): the block the page map places under it gets the hover outline. */
export function hover(ws: WorkspaceState, point: { page: number; x: number; y: number } | undefined): void {
  if (ws.kind !== "poster") return;
  const own = ticketsOf(ws);
  const block = point ? ws.linking.blockAt(point) : [];
  if (block.join(".") === (own.hovered?.join(".") ?? "")) return;
  own.hovered = block.length ? block : undefined;
  drawOutlines(ws);
}

/**
 * Outlines a poster's selected block, the block under the pointer and the overflowing blocks, by the build's page map; a talk shows the page
 * of its selected slide or section. While a build runs or after one failed, the selection keeps its last good outline, drawn stale.
 */
export function drawOutlines(ws: WorkspaceState): void {
  const own = ticketsOf(ws);
  const { kind, linking, selected } = ws;
  const { stage } = ws.ui;
  const page = kind === "poster" ? 1 : ws.section ? linking.pageOfSection(ws.section) : linking.pageOfSlide(slideIndex(ws));
  if (page !== undefined) stage.showPage(page);
  const outlines: StageOutline[] = [];
  // A poster's overflowing blocks, as the last loaded build marks them.
  for (const key of kind === "poster" ? ws.posterOverflow ?? [] : []) {
    const rect = linking.rectOf(key.split(".").map(Number));
    if (rect) outlines.push({ rect, tone: "overflow" });
  }
  const showSelection = kind === "poster" && selected.length >= 2 && !ws.preamble;
  const rect = showSelection ? linking.rectOf(selected) : undefined;
  // The poster block under the pointer, unless it is the selected one.
  const hovered = own.hovered && own.hovered.join(".") !== (showSelection ? selected.slice(0, 2).join(".") : "") ? linking.rectOf(own.hovered) : undefined;
  if (hovered) outlines.push({ rect: hovered, tone: "hover" });
  if (rect) outlines.push({ rect, tone: "selected" });
  let drawn: readonly StageOutline[] = outlines;
  const stale = ws.build.state === "building" || ws.build.state === "failed";
  const key = selected.join(".");
  if (!stale && rect) own.good = { selected: key, outlines };
  else if (stale && showSelection && !rect && own.good?.selected === key) {
    drawn = own.good.outlines.map((outline) => (outline.tone === "selected" ? { ...outline, tone: "stale" } : outline));
  }
  stage.setOutlines(drawn);
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
  structure?.render(tree, preamble ? [] : selected, preamble);
  grids.get(ws)?.render(tree, selected);
  const node = selectedNode(ws);
  props.render(node, {
    index: selected.at(-1) ?? 0, ...(kind === "poster" && node?.kind === "block" ? { column: selected[0]! } : {}),
    source: node ? (node.file === undefined ? text : textOf(ws, node.file)).slice(node.range[0], node.range[1]) : "", breadcrumb: sourceDeckBreadcrumb(tree, kind, selected).slice(1),
  });
  if (kind === "talk" && document.activeElement !== notes) notes.value = readSourceDeckNotes(ws.format, text)[slideIndex(ws)] ?? "";
  insertBar.refresh();
  renderStatus(ws);
  applyFocus(ws);
  void drawOutlines(ws);
}

/** A talk's slide list: a strip under the page in its code, which leaves the width to the code and the page; the left column elsewhere. */
function placeSlideList(ws: WorkspaceState): void {
  const list = ws.ui.structure?.element;
  const column = ws.ui.stage.element.parentElement;
  const body = column?.parentElement;
  // A poster is one page: it has no strip, and its blocks are picked on the page or in the code.
  if (!list || !column || !body) return;
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

/** Builds the tree again from the main text and the cached included files, and links the build's page map to it. */
export function refreshTree(ws: WorkspaceState): void {
  ws.tree = projectTree(ws);
  ws.linking.relink(ws.tree);
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

/** Reads the editor's text again, moving the page map's lines with the edit; new includes are read in the background. */
export function refreshText(ws: WorkspaceState): void {
  const text = ws.ports.editing.text();
  if (ws.text !== text) ws.linking.follow(ws.text, text);
  ws.text = text;
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
    const where = (): string => `${ws.preamble}:${ws.section?.file ?? ""}:${ws.section?.line ?? ""}:${ws.selected.join()}`;
    const was = where();
    if (selectSpanAt(ws, offset) && (force || where() !== was)) render(ws);
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
  // A build that brings no map (a preview, a failure) keeps the one the pages are linked by, moved with the edits since.
  if (!loaded || ws.build.pageMap) ws.linking.reset(loaded ? ws.build.pageMap : undefined, ws.tree);
  // A failed build keeps the badges of the last good one; posters get none (their print check is separate).
  const pdf = stage.pdf();
  if (loaded && pdf && ws.kind === "talk" && ws.build.state !== "failed") ws.overflow = await findOverflow(ws, pdf);
  if (loaded && pdf && ws.ui.poster && ws.build.state !== "failed") posterOverflow(ws, pdf);
  structure?.setPdf(stage.pdf());
  grids.get(ws)?.setPdf(stage.pdf());
  render(ws);
  if (loaded) buildMapOnce(ws);
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
  // Every state after the first comes from a build, which brings the map or failed: either way the map build is no longer wanted.
  ws.mapBuild = ws.mapBuild === undefined && ws.format === "latex" && !next.pageMap && next.state !== "building" && next.state !== "failed" ? "wanted" : "done";
  if (next.state === "succeeded" && (finished || !stage.pdf())) void reload(ws);
  else if (!stage.pdf()) stage.setEmpty(emptyStage(ws));
  else buildMapOnce(ws);
  // The outlines turn stale while the build runs and after it failed.
  if (next.state === "building" || next.state === "failed") void drawOutlines(ws);
}

/** A LaTeX PDF shown with no page map from any build gets one full build, so its pages link to the slides without a click on Build. */
function buildMapOnce(ws: WorkspaceState): void {
  if (ws.mapBuild !== "wanted" || !ws.ui.stage.pdf()) return;
  ws.mapBuild = "done";
  ws.ports.build.run();
}

/** Opens the first PDF after the workspace is mounted. */
export function loadFirst(ws: WorkspaceState): void { followIncludes(ws); void reload(ws); }
