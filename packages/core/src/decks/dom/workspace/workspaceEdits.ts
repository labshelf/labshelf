// The workspace's edits: every change goes through the editor as one undo step and schedules the build; a change of an included file's
// node is written to that file instead.
import {
  BLOCK_LAYOUTS, SLIDE_LAYOUTS, arrangeSourceSlide, deleteSourceDeckNode, duplicateSourceDeckNode, findSourceDeckNode, findSourceDeckPathAt, insertSourceBlock,
  insertSourceElement, insertSourceSlide, moveSourceDeckNode, moveSourceDeckNodeTo, restoreSourceDeckPath, setSourceDeckProp,
  type SlideArrangement, type SourceDeckChange, type SourceDeckElementKind, type SourceDeckNode, type SourceDeckPath, type SourceDeckPropName,
} from "../../index.js";
import type { FileDrop } from "../../../ui/dom/projectFileDrag.js";
import type { NodeAction } from "./propertiesPanel.js";
import { textOf, writeIncluded } from "./workspaceFiles.js";
import { flash, refreshText, refreshTree, render, setMode } from "./workspaceView.js";
import { selectedNode, slideIndex, type WorkspaceState } from "./workspaceState.js";

/**
 * Applies a change through the editor (one undo step) and schedules the build; in Visual the hidden editor gives the focus back. A change
 * of the included `file` is written to that file at once (not in the editor's history); the tree follows once the write succeeded.
 */
export function apply(ws: WorkspaceState, change: SourceDeckChange | null, select?: (next: SourceDeckNode[]) => SourceDeckPath, file?: string): boolean {
  const { editing } = ws.ports;
  if (!change || change.text === textOf(ws, file)) { if (!change) flash(ws, "LabShelf cannot write that here. Edit it in code."); return false; }
  const before = selectedNode(ws);
  if (file !== undefined) {
    writeIncluded(ws, file, change, () => {
      refreshTree(ws);
      ws.selected = select ? select(ws.tree) : restoreSourceDeckPath(ws.tree, ws.selected, before);
      ws.buildSoon.call();
      render(ws);
      flash(ws, `Saved to ${file}`);
    }, (message) => flash(ws, message));
    return true;
  }
  // The editor's own text event is ignored while the edit runs; a throw must not leave the workspace deaf to later changes.
  ws.ownEdit = true;
  try {
    const focused = document.activeElement as HTMLElement | null;
    editing.apply(change);
    if (ws.mode === "visual") focused?.focus?.();
    refreshText(ws);
    ws.selected = select ? select(ws.tree) : restoreSourceDeckPath(ws.tree, ws.selected, before);
  } finally {
    ws.ownEdit = false;
  }
  ws.buildSoon.call();
  render(ws);
  return true;
}

export function writeProp(ws: WorkspaceState, prop: SourceDeckPropName, value: string | number): void {
  const node = selectedNode(ws);
  if (!node) return;
  const path = [...ws.selected];
  apply(ws, setSourceDeckProp(ws.format, textOf(ws, node.file), node, prop, value), prop === "column" ? (next) => {
    const column = next[value as number];
    const count = column?.children?.length ?? 0;
    return count ? [value as number, count - 1] : path;
  } : undefined, node.file);
}

/** Moves the selected node up or down among its siblings; a poster block at a column's end moves into the neighbouring column. */
function moveNode(ws: WorkspaceState, node: SourceDeckNode, action: "up" | "down"): void {
  const { tree, selected } = ws;
  const current = textOf(ws, node.file);
  const parent = selected.length > 1 ? findSourceDeckNode(tree, selected.slice(0, -1)) : undefined;
  const siblings = parent?.children ?? tree;
  const index = selected.at(-1)!;
  const by = action === "up" ? -1 : 1;
  // A poster block at the end of its column moves into the neighbouring column.
  if (ws.kind === "poster" && node.kind === "block" && !siblings[index + by]) {
    const column = selected[0]! + by;
    if (tree[column]?.kind === "column") apply(ws, setSourceDeckProp(ws.format, current, node, "column", column), (next) => [column, Math.max(0, (next[column]?.children?.length ?? 1) - 1)]);
    return;
  }
  const path = [...selected];
  // Siblings in another file do not move with this one.
  const neighbour = siblings[index + by];
  if (neighbour && neighbour.file !== node.file) { flash(ws, "Slides in different files cannot be swapped."); return; }
  apply(ws, moveSourceDeckNode(current, siblings, index, by), () => [...path.slice(0, -1), index + by], node.file);
}

export function act(ws: WorkspaceState, action: NodeAction): void {
  const node = selectedNode(ws);
  if (!node) return;
  const { editing } = ws.ports;
  if (action === "code" && node.file !== undefined) { ws.ports.files?.open?.(node.file, node.line); return; }
  if (action === "code") { setMode(ws, "split"); editing.select(node.range[0], node.range[1]); ws.echo = editing.cursor(); return; }
  const current = textOf(ws, node.file);
  if (action === "delete") { apply(ws, deleteSourceDeckNode(current, node), () => ws.selected.slice(0, -1), node.file); return; }
  if (action === "duplicate") { const path = [...ws.selected]; apply(ws, duplicateSourceDeckNode(current, node), () => [...path.slice(0, -1), path.at(-1)! + 1], node.file); return; }
  moveNode(ws, node, action);
}

/** A slide action of the grid: selects slide `index` (a tree index) and duplicates or deletes it as one undo step. */
export function slideAct(ws: WorkspaceState, index: number, action: "duplicate" | "delete"): void {
  if (ws.tree[index]?.kind !== "slide") return;
  ws.selected = [index];
  act(ws, action);
}

/**
 * Moves slide `from` to where slide `to` is now (tree indexes) as one undo step, selecting it there. A slide moves only among the slides of
 * its own file; a move across another file's slides is refused with a message.
 */
export function moveSlideTo(ws: WorkspaceState, from: number, to: number): void {
  const slides = ws.tree.flatMap((node, index) => (node.kind === "slide" ? [{ node, index }] : []));
  const fromAt = slides.findIndex((slide) => slide.index === from);
  const toAt = slides.findIndex((slide) => slide.index === to);
  if (fromAt < 0 || toAt < 0 || fromAt === toAt) return;
  const { file } = slides[fromAt]!.node;
  if (slides.slice(Math.min(fromAt, toAt), Math.max(fromAt, toAt) + 1).some((slide) => slide.node.file !== file)) {
    flash(ws, "Slides in different files cannot be swapped.");
    return;
  }
  const same = slides.filter((slide) => slide.node.file === file);
  const change = moveSourceDeckNodeTo(textOf(ws, file), same.map((slide) => slide.node), same.indexOf(slides[fromAt]!), same.indexOf(slides[toAt]!));
  apply(ws, change, () => [to], file);
}

/** Lays out slide `index` (a tree index) again in `arrangement`, keeping its content, as one undo step. */
export function arrangeSlide(ws: WorkspaceState, index: number, arrangement: SlideArrangement): void {
  const slide = ws.tree[index];
  if (slide?.kind !== "slide") return;
  apply(ws, arrangeSourceSlide(ws.format, textOf(ws, slide.file), slide, arrangement), () => [index], slide.file);
}

/** The last block of a poster in tree order. */
function lastBlock(nodes: readonly SourceDeckNode[]): SourceDeckNode | undefined {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    const inner = node.children ? lastBlock(node.children) : undefined;
    if (inner) return inner;
    if (node.kind === "block") return node;
  }
  return undefined;
}

/**
 * The node new elements go after or into: the selection (Visual) or the node at the cursor (Split and Code); without one, the current
 * slide (talk) or the poster's last block. Undefined only when the deck has no slide or block.
 */
export function insertTarget(ws: WorkspaceState): SourceDeckNode | undefined {
  return chosenTarget(ws) ?? fallbackTarget(ws);
}

/** The selection (Visual) or the node at the cursor (Split and Code), when it can take an element. */
function chosenTarget(ws: WorkspaceState): SourceDeckNode | undefined {
  const path = ws.mode === "visual" ? ws.selected : findSourceDeckPathAt(ws.tree, ws.ports.editing.cursor(), (node) => node.file === undefined);
  const node = findSourceDeckNode(ws.tree, path);
  return node && node.kind !== "column" && node.kind !== "columns" && node.kind !== "code" ? node : undefined;
}

/** Without a chosen node: the current slide (talk) or the poster's last block. */
function fallbackTarget(ws: WorkspaceState): SourceDeckNode | undefined {
  if (ws.kind === "poster") return lastBlock(ws.tree);
  const slide = ws.tree[slideIndex(ws)];
  return slide?.kind === "slide" ? slide : undefined;
}

/** Where an element goes: a node takes it at the end of its body (container) or after itself (leaf); `file` names an included file. */
type InsertTarget = Pick<SourceDeckNode, "range" | "bodyRange" | "children" | "file">;

/** The toolbar's target: the chosen node, else the current slide (end of its body) or the poster's last block (after itself). */
function elementTarget(ws: WorkspaceState): InsertTarget | undefined {
  const chosen = chosenTarget(ws);
  if (chosen) return chosen;
  const fallback = fallbackTarget(ws);
  return fallback && ws.kind === "poster" ? { range: fallback.range, ...(fallback.file === undefined ? {} : { file: fallback.file }) } : fallback;
}

function insertAt(ws: WorkspaceState, target: InsertTarget, element: SourceDeckElementKind, src: string): void {
  const { file } = target;
  const change = insertSourceElement(ws.format, textOf(ws, file), target, element, src);
  apply(ws, change, (next) => (change ? findSourceDeckPathAt(next, change.cursor - 1, (node) => node.file === file) : ws.selected), file);
}

/** Inserts a figure showing `src` (a path relative to the deck file's folder) into or after `target` as one apply, in the target's file. */
function insertFigure(ws: WorkspaceState, target: InsertTarget, src: string): void {
  insertAt(ws, target, "figure", src);
}

export async function insertElement(ws: WorkspaceState, element: SourceDeckElementKind): Promise<void> {
  const { ports } = ws;
  if (!elementTarget(ws)) return;
  const src = element === "figure" && ports.pickImage ? await ports.pickImage() : "figure";
  if (src === undefined) return;
  // The pick may take a while: the target is read again from the tree as it is now.
  const target = elementTarget(ws);
  if (target) insertAt(ws, target, element, src);
}

/**
 * The node a figure dropped on `path` (a grid cell, a structure row or the node under the stage's point) goes into or after: column, columns
 * and code nodes give the slide or block they are in; a poster's column gives its last block, after itself.
 */
function dropTargetAt(ws: WorkspaceState, path: SourceDeckPath): InsertTarget | undefined {
  for (let depth = path.length; depth > 0; depth--) {
    const node = findSourceDeckNode(ws.tree, path.slice(0, depth));
    if (!node) return undefined;
    if (ws.kind === "poster" && node.kind === "column") {
      const last = lastBlock(node.children ?? []);
      return last ? { range: last.range, ...(last.file === undefined ? {} : { file: last.file }) } : undefined;
    }
    if (node.kind !== "column" && node.kind !== "columns" && node.kind !== "code") return node;
  }
  return undefined;
}

/** The stage's target for a drop at `point`: the node under it by the same hit test as a click, else the page's slide, else the fallback. */
async function stageTarget(ws: WorkspaceState, point: { page: number; x: number; y: number }): Promise<InsertTarget | undefined> {
  const { tree, linking } = ws;
  const path = await linking.pathAt(point, tree, () => true);
  if (ws.tree !== tree) return undefined;
  const hit = path.length ? dropTargetAt(ws, path) : undefined;
  if (hit) return hit;
  if (ws.kind === "talk") {
    const slide = linking.slideOfPage(point.page) ?? slideIndex(ws);
    return ws.tree[slide]?.kind === "slide" ? ws.tree[slide] : undefined;
  }
  return elementTarget(ws);
}

/**
 * Inserts a figure of a dropped file: the host's dropImage gives its path relative to the deck file's folder (undefined refuses it), then
 * the figure goes to `at` (a tree path: a grid cell or structure row) or to the node under the stage's point.
 */
export async function dropFigure(ws: WorkspaceState, drop: FileDrop, at: SourceDeckPath | { page: number; x: number; y: number }): Promise<void> {
  const { dropImage } = ws.ports;
  if (!dropImage) return;
  const src = await dropImage(drop);
  if (src === undefined) return;
  const target = Array.isArray(at) ? dropTargetAt(ws, at) : await stageTarget(ws, at as { page: number; x: number; y: number });
  if (target) insertFigure(ws, target, src);
}

export function newSlide(ws: WorkspaceState, layout: (typeof SLIDE_LAYOUTS)[number]["id"]): void {
  const { editing } = ws.ports;
  const slide = ws.tree[slideIndex(ws)];
  const at = ws.kind === "talk" && slide ? slide.range[0] : editing.cursor();
  // In Visual the new slide goes before the current one, in that slide's file.
  const file = ws.mode === "visual" && ws.kind === "talk" ? slide?.file : undefined;
  const change = insertSourceSlide(ws.format, textOf(ws, file), ws.mode === "visual" ? at : editing.cursor(), layout);
  apply(ws, change, (next) => findSourceDeckPathAt(next, change.cursor, (node) => node.file === file).slice(0, 1), file);
}

export function newBlock(ws: WorkspaceState, layout: (typeof BLOCK_LAYOUTS)[number]["id"]): void {
  const { editing } = ws.ports;
  const node = ws.mode === "visual" ? findSourceDeckNode(ws.tree, ws.selected.slice(0, 2)) : undefined;
  const at = node && node.kind === "block" ? node.range[1] : editing.cursor();
  const change = insertSourceBlock(ws.format, editing.text(), at, layout);
  apply(ws, change, (next) => findSourceDeckPathAt(next, change.cursor, (n) => n.kind === "block"));
}
