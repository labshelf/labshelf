// The workspace's UI in the shell: the header, the insert bar with its Size and Layout menus, the panels, the stage with the zoom bar,
// the status bar and the shared keys.
import { renderElement } from "../../../ui/dom/index.js";
import {
  BLOCK_LAYOUTS, SLIDE_LAYOUTS, listSourceDeckShapes, readSourceDeckShape, readSourceSlideLayout,
  setSourceDeckShape, setSourceNote, setSourceSlideLayout, type SourceDeckElementKind,
} from "../../index.js";
import {
  bindShellKeys, createInsertBar, createShellHeader, createShellStatus, createZoomBar, mountDeckShell, type InsertItem, type ShellKeyActions, type ShellZoomBar,
} from "../shell/index.js";
import { createActionBar, createPropertiesPanel } from "./propertiesPanel.js";
import { createStage, type Stage } from "./stage.js";
import { createStructurePanel } from "./structurePanel.js";
import { createStyleToggle } from "./workspaceStyle.js";
import { act, apply, insertElement, insertTarget, newBlock, newSlide, writeProp } from "./workspaceEdits.js";
import { cursorMoved, drawOutlines, pick, select, setMode } from "./workspaceView.js";
import { selectedNode, slideIndex, type WorkspaceState, type WorkspaceUi } from "./workspaceState.js";

const ELEMENTS: ReadonlyArray<{ kind: SourceDeckElementKind; label: string; icon: InsertItem["icon"] }> = [
  { kind: "text", label: "Text", icon: "heading" }, { kind: "figure", label: "Figure", icon: "file-media" }, { kind: "equation", label: "Equation", icon: "sigma" },
  { kind: "table", label: "Table", icon: "table" }, { kind: "list", label: "List", icon: "list" },
];

/** The Aspect ratio (talk) or Size (poster) menu. */
function shapeMenu(ws: WorkspaceState): InsertItem {
  const { kind, format } = ws;
  const { editing } = ws.ports;
  const shapes = listSourceDeckShapes(kind, format);
  return {
    icon: "grid", label: kind === "talk" ? "Aspect ratio" : "Size",
    menu: () => {
      const current = readSourceDeckShape(format, kind, editing.text());
      return shapes.map((choice) => ({ label: choice.label, radio: true, checked: choice.label === current, onSelect: () => { const next = setSourceDeckShape(format, editing.text(), choice.shape); apply(ws, next === null ? null : { text: next, cursor: editing.cursor() }); } }));
    },
  };
}

/** The Layout menu of a talk's slide. */
function layoutMenu(ws: WorkspaceState): InsertItem {
  const { format } = ws;
  const { editing } = ws.ports;
  return {
    icon: "layers", label: "Layout",
    disabled: () => { const slide = ws.tree[slideIndex(ws)]; return slide && readSourceSlideLayout(format, editing.text(), slide) ? undefined : "Layout changes a slide whose body is still a starter layout"; },
    menu: () => SLIDE_LAYOUTS.map((layout) => ({ label: layout.label, onSelect: () => { const slide = ws.tree[slideIndex(ws)]; if (slide) apply(ws, setSourceSlideLayout(format, editing.text(), slide, layout.id)); } })),
  };
}

/** The insert bar: slides or blocks, elements, layout and size, then Style, Sync selection and Reveal in preview. */
function buildInsertBar(ws: WorkspaceState, style: HTMLElement): WorkspaceUi["insertBar"] {
  const { kind } = ws;
  const { editing } = ws.ports;
  const noTarget = (): string | undefined => (insertTarget(ws) ? undefined : kind === "talk" ? "Add a slide first" : "Add a block first");
  const elementItems: InsertItem[] = ELEMENTS.map(({ kind: element, label, icon }) => ({ icon, label, run: () => void insertElement(ws, element), disabled: noTarget }));
  const syncButton = renderElement("label", { class: "dw-check" }, renderElement("input", { type: "checkbox", checked: true }), renderElement("span", { text: "Sync selection" }));
  syncButton.querySelector("input")!.addEventListener("change", (event) => { ws.sync = (event.target as HTMLInputElement).checked; void drawOutlines(ws); });
  const reveal = renderElement("button", { type: "button", class: "dw-insert", text: "Reveal in preview" });
  reveal.addEventListener("click", () => { cursorMoved(ws, editing.cursor(), true); });
  return createInsertBar(kind === "talk" ? [
    [{ icon: "plus", label: "New slide", menu: () => SLIDE_LAYOUTS.map((layout) => ({ label: layout.label, onSelect: () => newSlide(ws, layout.id) })) }],
    elementItems,
    [layoutMenu(ws), shapeMenu(ws)],
  ] : [
    [{ icon: "plus", label: "Block", menu: () => BLOCK_LAYOUTS.map((layout) => ({ label: layout.label, onSelect: () => newBlock(ws, layout.id) })) }],
    elementItems,
    [shapeMenu(ws)],
  ], [style, syncButton, reveal]);
}

/** The speaker notes box under a talk's stage. */
function buildNotes(ws: WorkspaceState): { notes: HTMLTextAreaElement; notesPanel: HTMLElement } {
  const notes = renderElement("textarea", { class: "dw-notes-input", placeholder: "Speaker notes for this slide", "aria-label": "Speaker notes" });
  notes.addEventListener("change", () => { const slide = ws.tree[slideIndex(ws)]; if (slide) apply(ws, setSourceNote(ws.format, ws.ports.editing.text(), slide, notes.value.trim())); });
  const notesPanel = renderElement("section", { class: "dw-notes" }, renderElement("div", { class: "dw-panel-heading", text: "Speaker notes" }), notes);
  return { notes, notesPanel };
}

/** The shell's keys over the workspace: undo and redo in the editor, the zoom bar, slide paging, and delete, deselect and duplicate in Visual. */
function keyActions(ws: WorkspaceState, zoomBar: ShellZoomBar, stage: Stage): ShellKeyActions {
  const { editing } = ws.ports;
  const slides = (): number => ws.tree.filter((n) => n.kind === "slide").length;
  const visualNode = (): boolean => ws.mode === "visual" && selectedNode(ws) !== undefined;
  return {
    ...(editing.undo ? { undo: () => editing.undo?.() } : {}),
    ...(editing.redo ? { redo: () => editing.redo?.() } : {}),
    zoomIn: () => zoomBar.zoomIn(), zoomOut: () => zoomBar.zoomOut(), fit: () => zoomBar.fit(),
    setTool: (tool) => zoomBar.setTool(tool), holdHand: (held) => stage.holdHand(held),
    get previous() { return ws.kind === "talk" ? () => { const index = slideIndex(ws); if (index > 0) select(ws, [index - 1]); } : undefined; },
    get next() { return ws.kind === "talk" ? () => { const index = slideIndex(ws); if (index + 1 < slides()) select(ws, [index + 1]); } : undefined; },
    get deleteSelection() { return visualNode() ? () => act(ws, "delete") : undefined; },
    get duplicate() { return visualNode() ? () => act(ws, "duplicate") : undefined; },
    // A talk keeps its slide: clearing leaves the current slide selected as a whole.
    get clearSelection() { return ws.selected.length > (ws.kind === "talk" ? 1 : 0) ? () => select(ws, ws.kind === "talk" ? [slideIndex(ws)] : []) : undefined; },
  } as ShellKeyActions; // The getters answer undefined while their key does not apply, so the page keeps it.
}

/** Builds the workspace's elements and panels in the shell mounted in `host`; their callbacks act on `ws`, whose `ui` is filled with the result. */
export function buildUi(ws: WorkspaceState, host: HTMLElement): WorkspaceUi {
  const { kind, ports } = ws;
  const header = createShellHeader({
    title: ws.name, badge: ws.format === "latex" ? "LaTeX" : "Typst", modes: ["visual", "split", "code"], onMode: (next) => setMode(ws, next),
    build: { run: () => ports.build.run(), showProblems: () => ports.showProblems() },
    show: kind === "talk" ? { label: "Present", icon: "play", run: () => ports.present() } : { label: "Real size", icon: "eye", run: () => ports.posterPreview() },
    exports: [{ label: "PDF", icon: "download", run: () => ports.exportPdf() }],
  });
  const style = createStyleToggle(ws);
  const bar = buildInsertBar(ws, style.button);
  const insertBar = { element: bar.element, refresh: () => { bar.refresh(); style.render(); } };
  const structure = createStructurePanel(kind, { select: (path) => select(ws, path, true), newSlide: (layout) => newSlide(ws, layout), pageOfSlide: (slide) => ws.linking.pageOfSlide(slide) });
  const actionBar = createActionBar((action) => act(ws, action));
  let zoomBar: ShellZoomBar | undefined;
  const stage = createStage(ports, (point) => void pick(ws, point), () => void drawOutlines(ws), () => zoomBar?.render());
  zoomBar = createZoomBar(stage.surface, { guides: { on: () => stage.guides(), toggle: () => stage.toggleGuides() } });
  const props = createPropertiesPanel({
    write: (prop, value) => writeProp(ws, prop, value), action: (action) => act(ws, action), columns: () => ws.tree.filter((n) => n.kind === "column").length,
    ...(ports.pickImage ? { replaceImage: () => void ports.pickImage!().then((src) => { if (src) writeProp(ws, "src", src); }) } : {}),
  });
  const { notes, notesPanel } = buildNotes(ws);
  const status = createShellStatus();
  const shell = mountDeckShell(host, {
    format: ws.format, kind, header: header.element, insert: insertBar.element, left: structure.element, stage: stage.element, zoom: zoomBar.element,
    props: props.element, status: status.element, code: ports.editor, ...(kind === "talk" ? { notes: notesPanel } : {}),
  });
  const { root } = shell;
  const destroyShell = shell.destroy;
  shell.destroy = () => { style.destroy(); destroyShell(); };
  // Focusable, so a click anywhere in the workspace keeps its keys.
  root.tabIndex = -1;
  const unbindKeys = bindShellKeys(root, keyActions(ws, zoomBar, stage));
  return { root, shell, unbindKeys, header, insertBar, structure, actionBar, stage, props, notes, status };
}
