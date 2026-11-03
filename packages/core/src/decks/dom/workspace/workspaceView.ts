// The workspace's selection, drawing, modes, cursor and builds: what shows on the stage and panels, and how the text and the build state reach them.
import { renderElement } from "../../../ui/dom/index.js";
import { findSourceDeckNode, findSourceDeckPathAt, readSourceDeckBlocks, readSourceDeckNotes, readSourceDeckShape, restoreSourceDeckPath, sourceDeckBreadcrumb, type SourceDeckNode, type SourceDeckPath } from "../../index.js";
import type { StageOutline } from "./stage.js";
import type { DeckBuildState, DeckWorkspaceMode } from "./types.js";
import { selectedNode, slideIndex, type WorkspaceState } from "./workspaceState.js";

export function flash(ws: WorkspaceState, message: string): void {
  const { stage } = ws.ui;
  stage.setNote(message);
  clearTimeout(ws.flashTimer);
  ws.flashTimer = setTimeout(() => stage.setNote(ws.linking.note()), 4000);
}

export function select(ws: WorkspaceState, path: SourceDeckPath, fromPanel = false): void {
  ws.selected = path;
  if (fromPanel && ws.mode === "split") { const node = selectedNode(ws); if (node) ws.ports.editing.reveal(node.range[0]); }
  render(ws);
}

/** A click on the page: the block under it, or (when that block is already selected) the element inside it. */
export async function pick(ws: WorkspaceState, point: { page: number; x: number; y: number }): Promise<void> {
  const { kind, linking, tree, selected } = ws;
  const container = kind === "talk" ? (n: SourceDeckNode) => n.kind !== "slide" : (n: SourceDeckNode) => n.kind === "block";
  let path = await linking.pathAt(point, tree, kind === "talk" ? () => true : container);
  if (kind === "poster" && path.length >= 2 && selected.length >= 2 && path[0] === selected[0] && path[1] === selected[1]) {
    const inner = await linking.pathAt(point, tree, () => true);
    if (inner.length > 2) path = inner;
  }
  if (kind === "talk" && path.length === 0) path = [linking.slideOfPage(point.page) ?? slideIndex(ws)];
  if (kind === "poster" && path.length === 0) path = selected.slice(0, 1);
  if (ws.mode === "split" && ws.sync) { const node = findSourceDeckNode(tree, path); if (node) ws.ports.editing.reveal(node.range[0]); }
  select(ws, path);
}

export async function drawOutlines(ws: WorkspaceState): Promise<void> {
  const { kind, linking, tree, selected } = ws;
  const { stage } = ws.ui;
  const outlines: StageOutline[] = [];
  const page = kind === "talk" ? linking.pageOfSlide(slideIndex(ws)) : 1;
  if (page !== undefined) stage.showPage(page);
  if (stage.guides()) {
    const containers = kind === "talk" ? (tree[slideIndex(ws)]?.children ?? []).map((_, i) => [slideIndex(ws), i]) : tree.flatMap((column, c) => (column.children ?? []).map((_, b) => [c, b]));
    for (const path of containers) { const rect = await linking.rectOf(path, tree, page); if (rect) outlines.push({ rect, tone: "guide" }); }
  }
  const showSelection = selected.length > 0 && (ws.mode === "visual" || ws.sync) && !(kind === "talk" && selected.length === 1);
  const rect = showSelection ? await linking.rectOf(selected, tree, page) : undefined;
  if (rect) outlines.push({ rect, tone: "selected" });
  stage.setOutlines(outlines);
  stage.placeBar(ws.ui.actionBar, ws.mode === "visual" ? rect : undefined);
  // Asking for a rectangle tells whether SyncTeX places the nodes; the note says when it does not.
  stage.setNote(linking.note());
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
  ws.ui.status.set({ left: `Poster${shape ? ` · ${shape}` : ""}${mm}`, crumb });
}

export function render(ws: WorkspaceState): void {
  const { kind, tree, selected, text } = ws;
  const { structure, props, notes, insertBar } = ws.ui;
  structure.render(tree, selected);
  const node = selectedNode(ws);
  props.render(node, {
    index: selected.at(-1) ?? 0, ...(kind === "poster" && node?.kind === "block" ? { column: selected[0]! } : {}),
    source: node ? text.slice(node.range[0], node.range[1]) : "", linked: ws.linking.linked(), breadcrumb: sourceDeckBreadcrumb(tree, kind, selected).slice(1),
  });
  if (kind === "talk" && document.activeElement !== notes) notes.value = readSourceDeckNotes(ws.format, text)[slideIndex(ws)] ?? "";
  insertBar.refresh();
  renderStatus(ws);
  void drawOutlines(ws);
}

export function setMode(ws: WorkspaceState, next: DeckWorkspaceMode): void {
  ws.mode = next;
  ws.ui.root.dataset["mode"] = next;
  ws.ui.header.setMode(next);
  ws.ports.mode.write(next);
  if (next === "split") cursorMoved(ws, ws.ports.editing.cursor(), true);
  render(ws);
}

/** Reads the editor's text again: the tree, and the rectangles found for it, start over. */
export function refreshText(ws: WorkspaceState): void {
  ws.text = ws.ports.editing.text();
  ws.tree = readSourceDeckBlocks(ws.format, ws.kind, ws.text);
  ws.linking.forget();
}

export function cursorMoved(ws: WorkspaceState, offset: number, force = false): void {
  if (ws.mode !== "split" || (!ws.sync && !force)) return;
  const path = findSourceDeckPathAt(ws.tree, offset);
  if (path.join() === ws.selected.join() && !force) return;
  ws.selected = path;
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

async function reload(ws: WorkspaceState): Promise<void> {
  const { stage, structure } = ws.ui;
  const loaded = await stage.load().catch(() => false);
  stage.setEmpty(loaded ? null : emptyStage(ws));
  await ws.linking.reset(stage.pdf(), ws.tree, ws.text);
  structure.setPdf(stage.pdf());
  stage.setNote(ws.linking.note());
  render(ws);
}

/** A build state arrived: shows it in the header and loads the PDF after a successful build. */
export function buildStateChanged(ws: WorkspaceState, next: DeckBuildState): void {
  const { stage } = ws.ui;
  const finished = ws.build.state === "building" && next.state !== "building";
  ws.build = next;
  ws.ui.header.setBuild(next);
  if (next.state === "succeeded" && (finished || !stage.pdf())) void reload(ws);
  else if (!stage.pdf()) stage.setEmpty(emptyStage(ws));
}

/** Opens the first PDF after the workspace is mounted. */
export function loadFirst(ws: WorkspaceState): void { void reload(ws); }
