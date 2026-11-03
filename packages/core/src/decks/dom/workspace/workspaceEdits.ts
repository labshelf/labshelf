// The workspace's edits: every change goes through the editor as one undo step and schedules the build.
import {
  BLOCK_LAYOUTS, SLIDE_LAYOUTS, deleteSourceDeckNode, duplicateSourceDeckNode, findSourceDeckNode, findSourceDeckPathAt, insertSourceBlock, insertSourceElement,
  insertSourceSlide, moveSourceDeckNode, restoreSourceDeckPath, setSourceDeckProp,
  type SourceDeckChange, type SourceDeckElementKind, type SourceDeckNode, type SourceDeckPath, type SourceDeckPropName,
} from "../../index.js";
import type { NodeAction } from "./propertiesPanel.js";
import { flash, refreshText, render, setMode } from "./workspaceView.js";
import { selectedNode, slideIndex, type WorkspaceState } from "./workspaceState.js";

/** Applies a change through the editor (one undo step) and schedules the build; in Visual the hidden editor gives the focus back. */
export function apply(ws: WorkspaceState, change: SourceDeckChange | null, select?: (next: SourceDeckNode[]) => SourceDeckPath): boolean {
  const { editing } = ws.ports;
  if (!change || change.text === editing.text()) { if (!change) flash(ws, "LabShelf cannot write that here. Edit it in code."); return false; }
  const before = selectedNode(ws);
  ws.ownEdit = true;
  const focused = document.activeElement as HTMLElement | null;
  editing.apply(change);
  if (ws.mode === "visual") focused?.focus?.();
  refreshText(ws);
  ws.selected = select ? select(ws.tree) : restoreSourceDeckPath(ws.tree, ws.selected, before);
  ws.ownEdit = false;
  ws.buildSoon.call();
  render(ws);
  return true;
}

export function writeProp(ws: WorkspaceState, prop: SourceDeckPropName, value: string | number): void {
  const node = selectedNode(ws);
  if (!node) return;
  const path = [...ws.selected];
  apply(ws, setSourceDeckProp(ws.format, ws.ports.editing.text(), node, prop, value), prop === "column" ? (next) => {
    const column = next[value as number];
    const count = column?.children?.length ?? 0;
    return count ? [value as number, count - 1] : path;
  } : undefined);
}

/** Moves the selected node up or down among its siblings; a poster block at a column's end moves into the neighbouring column. */
function moveNode(ws: WorkspaceState, node: SourceDeckNode, action: "up" | "down"): void {
  const { tree, selected } = ws;
  const current = ws.ports.editing.text();
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
  apply(ws, moveSourceDeckNode(current, siblings, index, by), () => [...path.slice(0, -1), index + by]);
}

export function act(ws: WorkspaceState, action: NodeAction): void {
  const node = selectedNode(ws);
  if (!node) return;
  const { editing } = ws.ports;
  if (action === "code") { setMode(ws, "split"); editing.select(node.range[0], node.range[1]); return; }
  const current = editing.text();
  if (action === "delete") { apply(ws, deleteSourceDeckNode(current, node), () => ws.selected.slice(0, -1)); return; }
  if (action === "duplicate") { const path = [...ws.selected]; apply(ws, duplicateSourceDeckNode(current, node), () => [...path.slice(0, -1), path.at(-1)! + 1]); return; }
  moveNode(ws, node, action);
}

/** The node new elements go after: the selection (Visual), the node at the cursor (Split and Code). */
export function insertTarget(ws: WorkspaceState): SourceDeckNode | undefined {
  const path = ws.mode === "visual" ? ws.selected : findSourceDeckPathAt(ws.tree, ws.ports.editing.cursor());
  let node = findSourceDeckNode(ws.tree, path);
  if (node?.kind === "column" || node?.kind === "columns" || node?.kind === "code") node = undefined;
  return node;
}

export async function insertElement(ws: WorkspaceState, element: SourceDeckElementKind): Promise<void> {
  const { ports } = ws;
  const target = insertTarget(ws);
  if (!target) return;
  const src = element === "figure" && ports.pickImage ? await ports.pickImage() : "figure";
  if (src === undefined) return;
  const change = insertSourceElement(ws.format, ports.editing.text(), target, element, src);
  apply(ws, change, (next) => (change ? findSourceDeckPathAt(next, change.cursor - 1) : ws.selected));
}

export function newSlide(ws: WorkspaceState, layout: (typeof SLIDE_LAYOUTS)[number]["id"]): void {
  const { editing } = ws.ports;
  const slide = ws.tree[slideIndex(ws)];
  const at = ws.kind === "talk" && slide ? slide.range[0] : editing.cursor();
  const change = insertSourceSlide(ws.format, editing.text(), ws.mode === "visual" ? at : editing.cursor(), layout);
  apply(ws, change, (next) => findSourceDeckPathAt(next, change.cursor).slice(0, 1));
}

export function newBlock(ws: WorkspaceState, layout: (typeof BLOCK_LAYOUTS)[number]["id"]): void {
  const { editing } = ws.ports;
  const node = ws.mode === "visual" ? findSourceDeckNode(ws.tree, ws.selected.slice(0, 2)) : undefined;
  const at = node && node.kind === "block" ? node.range[1] : editing.cursor();
  const change = insertSourceBlock(ws.format, editing.text(), at, layout);
  apply(ws, change, (next) => findSourceDeckPathAt(next, change.cursor, (n) => n.kind === "block"));
}
