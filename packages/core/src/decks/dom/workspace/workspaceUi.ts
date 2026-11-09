// The workspace's UI in the shell: the header, the insert bar with its Size and Layout menus, the panels, the stage with the zoom bar,
// the status bar and the shared keys.
import { renderElement, renderIcon } from "../../../ui/dom/index.js";
import type { FileDrop } from "../../../ui/dom/projectFileDrag.js";
import {
  BLOCK_LAYOUTS, SLIDE_LAYOUTS, listSourceDeckShapes, readSourceDeckShape, readSourceSlideLayout,
  setSourceDeckShape, setSourceNote, setSourceSlideLayout, type SourceDeckElementKind, type SourceDeckPath,
} from "../../index.js";
import {
  bindShellKeys, createInsertBar, shellButton, createShellHeader, createShellStatus, createZoomBar, mountDeckShell, type InsertItem, type ShellKeyActions, type ShellRect, type ShellZoomBar,
  type ShellZoomTarget,
} from "../shell/index.js";
import { createMinimap } from "../minimap.js";
import { createSlideGrid, type SlideGrid } from "./slideGrid.js";
import { createActionBar, createPropertiesPanel } from "./propertiesPanel.js";
import { createStage, type Stage } from "./stage.js";
import { createStructurePanel } from "./structurePanel.js";
import { createStyleToggle, createWorkspacePoster, type WorkspacePoster } from "./workspaceStyle.js";
import { act, apply, arrangeSlide, dropFigure, insertElement, insertTarget, moveSlideTo, newBlock, newSlide, slideAct, writeProp } from "./workspaceEdits.js";
import { attachGrid, cursorMoved, drawOutlines, hover, pick, render, select, selectPreamble, setMode } from "./workspaceView.js";
import { codeFirst, selectedNode, slideIndex, type WorkspaceState, type WorkspaceUi } from "./workspaceState.js";

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

/** The insert bar: slides or blocks, elements, layout and size, then Style (and Poster for a poster), Sync selection and Reveal in preview. */
function buildInsertBar(ws: WorkspaceState, panels: HTMLElement[]): WorkspaceUi["insertBar"] {
  const { kind } = ws;
  const { editing } = ws.ports;
  const noTarget = (): string | undefined => (insertTarget(ws) ? undefined : kind === "talk" ? "Add a slide first" : "Add a block first");
  const elementItems: InsertItem[] = ELEMENTS.map(({ kind: element, label, icon }) => ({ icon, label, run: () => void insertElement(ws, element), disabled: noTarget }));
  const syncButton = renderElement("label", { class: "dw-check" }, renderElement("input", { type: "checkbox", checked: true }), renderElement("span", { text: "Sync selection" }));
  syncButton.querySelector("input")!.addEventListener("change", (event) => { ws.sync = (event.target as HTMLInputElement).checked; void drawOutlines(ws); });
  const reveal = renderElement("button", { type: "button", class: "dw-insert dw-reveal", text: "Reveal in preview" });
  reveal.addEventListener("click", () => { cursorMoved(ws, editing.cursor(), true); });
  return createInsertBar(kind === "talk" ? [
    [{ icon: "plus", label: "New slide", menu: () => SLIDE_LAYOUTS.map((layout) => ({ label: layout.label, onSelect: () => newSlide(ws, layout.id) })) }],
    elementItems,
    [layoutMenu(ws), shapeMenu(ws)],
  ] : [
    [{ icon: "plus", label: "Block", menu: () => BLOCK_LAYOUTS.map((layout) => ({ label: layout.label, onSelect: () => newBlock(ws, layout.id) })) }],
    elementItems,
    [shapeMenu(ws)],
  ], [...panels, syncButton, reveal]);
}

/** The speaker notes box under a talk's stage. */
function buildNotes(ws: WorkspaceState): { notes: HTMLTextAreaElement; notesPanel: HTMLElement } {
  const notes = renderElement("textarea", { class: "dw-notes-input", placeholder: "Speaker notes for this slide", "aria-label": "Speaker notes" });
  notes.addEventListener("change", () => { const slide = ws.tree[slideIndex(ws)]; if (slide) apply(ws, setSourceNote(ws.format, ws.ports.editing.text(), slide, notes.value.trim())); });
  const notesPanel = renderElement("section", { class: "dw-notes" }, renderElement("div", { class: "dw-panel-heading", text: "Speaker notes" }), notes);
  return { notes, notesPanel };
}

/** The selected poster block's path (the block holding a selected element), or undefined when no block is selected. */
function selectedBlockPath(ws: WorkspaceState): SourceDeckPath | undefined {
  const [column, block] = ws.selected;
  if (ws.kind !== "poster" || column === undefined || block === undefined) return undefined;
  return ws.tree[column]?.kind === "column" && ws.tree[column]?.children?.[block]?.kind === "block" ? [column, block] : undefined;
}

const rectOfSource = (rect: { left: number; top: number; right: number; bottom: number }): ShellRect => ({ left: rect.left, top: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top });

/** Zoom to section of a compiled poster: the selected block's rect through the linking. */
function zoomTarget(ws: WorkspaceState, stage: Stage): ShellZoomTarget {
  return {
    enabled: () => ws.mode !== "code" && selectedBlockPath(ws) !== undefined && stage.pdf() !== undefined,
    run() {
      const path = selectedBlockPath(ws);
      if (!path) return;
      void ws.linking.rectOf(path, ws.tree, stage.page()).then((rect) => {
        if (!rect) return;
        stage.showPage(rect.page);
        stage.surface.zoomToRect?.(rectOfSource(rect));
      }, () => undefined);
    },
  };
}

/** A compiled poster's minimap over the stage: the page, the blocks' rects through the linking and the visible part, redrawn on every view change. */
function mountMinimap(ws: WorkspaceState, stage: Stage): void {
  let boxes: ShellRect[] = [];
  let measured: { tree: unknown; pdf: unknown; page: number } | undefined;
  let ticket = 0;
  const minimap = createMinimap({ page: () => stage.pageSize(), boxes: () => boxes, viewport: () => stage.surface.viewport?.() ?? null, panTo: (centre) => stage.panTo(centre) });
  const measure = (): void => {
    // A new build (its PDF) or an edit (its tree) moves the blocks.
    if (measured && measured.tree === ws.tree && measured.pdf === stage.pdf() && measured.page === stage.page()) return;
    measured = { tree: ws.tree, pdf: stage.pdf(), page: stage.page() };
    const own = ++ticket;
    const tree = ws.tree;
    const paths = tree.flatMap((node, c) => (node.kind !== "column" ? [] : (node.children ?? []).flatMap((child, b) => (child.kind === "block" ? [[c, b]] : []))));
    void Promise.all(paths.map((path) => ws.linking.rectOf(path, tree, stage.page()).catch(() => undefined))).then((rects) => {
      if (own !== ticket) return;
      boxes = rects.flatMap((rect) => (rect && rect.page === stage.page() ? [rectOfSource(rect)] : []));
      minimap.render();
    });
  };
  stage.onView(() => { measure(); minimap.render(); });
  stage.element.append(minimap.element);
}

/** The shell's keys over the workspace: undo and redo in the editor, the zoom bar, slide paging, and delete, deselect and duplicate in Visual and Grid. */
function keyActions(ws: WorkspaceState, zoomBar: ShellZoomBar, stage: Stage, target: ShellZoomTarget): ShellKeyActions {
  const { editing } = ws.ports;
  const slides = (): number => ws.tree.filter((n) => n.kind === "slide").length;
  const visualNode = (): boolean => (ws.mode === "visual" || ws.gridShown) && selectedNode(ws) !== undefined;
  return {
    ...(editing.undo ? { undo: () => editing.undo?.() } : {}),
    ...(editing.redo ? { redo: () => editing.redo?.() } : {}),
    zoomIn: () => zoomBar.zoomIn(), zoomOut: () => zoomBar.zoomOut(), fit: () => zoomBar.fit(),
    setTool: (tool) => zoomBar.setTool(tool), holdHand: (held) => stage.holdHand(held),
    get previous() { return ws.kind === "talk" ? () => { const index = slideIndex(ws); if (index > 0) select(ws, [index - 1]); } : undefined; },
    get next() { return ws.kind === "talk" ? () => { const index = slideIndex(ws); if (index + 1 < slides()) select(ws, [index + 1]); } : undefined; },
    get deleteSelection() { return visualNode() ? () => act(ws, "delete") : undefined; },
    get duplicate() { return visualNode() ? () => act(ws, "duplicate") : undefined; },
    get zoomToSelection() { return ws.kind === "poster" ? () => { if (target.enabled()) target.run(); } : undefined; },
    // The code keeps its slide or block; a talk's Grid keeps the current slide selected as a whole.
    get clearSelection() { return !codeFirst(ws) && ws.selected.length > (ws.kind === "talk" ? 1 : 0) ? () => select(ws, ws.kind === "talk" ? [slideIndex(ws)] : []) : undefined; },
  } as ShellKeyActions; // The getters answer undefined while their key does not apply, so the page keeps it.
}

/** A talk's slide grid: its cells select, open in Visual, reorder, duplicate, delete and arrange slides through the workspace's edits. */
function buildGrid(ws: WorkspaceState): SlideGrid {
  const grid = createSlideGrid({
    select: (slide) => select(ws, [slide]),
    open: (slide) => { ws.selected = [slide]; setMode(ws, "split"); },
    move: (from, to) => moveSlideTo(ws, from, to),
    duplicate: (slide) => slideAct(ws, slide, "duplicate"),
    remove: (slide) => slideAct(ws, slide, "delete"),
    arrange: (slide, arrangement) => arrangeSlide(ws, slide, arrangement),
    pageOfSlide: (slide) => ws.linking.pageOfSlide(slide),
    overflowOfSlide: (slide) => ws.overflow?.has(slide) ?? false,
    ...(ws.ports.dropImage ? { dropImage: (slide: number, drop: FileDrop) => void dropFigure(ws, drop, [slide]) } : {}),
  });
  attachGrid(ws, grid);
  return grid;
}

/**
 * The view controls in the header, in place of the mode tabs: the code by Slide (talk) or Block (poster) or the whole File, a talk's Grid,
 * and the eye that shows or hides the preview beside the code (Split or Code).
 */
function viewControls(ws: WorkspaceState, header: WorkspaceUi["header"]): HTMLElement {
  const unit = ws.kind === "talk" ? "slide" : "block";
  const bySlide = shellButton(ws.kind === "talk" ? "file" : "text-box", ws.kind === "talk" ? "Slide" : "Block", "dw-mode", () => { ws.wholeFile = false; render(ws); update(); });
  const whole = shellButton("code", "File", "dw-mode", () => { ws.wholeFile = true; render(ws); update(); });
  bySlide.title = `Show the code of the selected ${unit}`; whole.title = "Show the whole file";
  const grid = ws.kind === "talk" ? shellButton("grid", "Grid", "dw-mode", () => setMode(ws, ws.gridShown ? "split" : "grid")) : undefined;
  const eye = shellButton("eye", "Preview", "dw-mode dw-eye", () => setMode(ws, ws.mode === "code" ? "split" : "code"));
  const update = (): void => {
    bySlide.setAttribute("aria-pressed", String(!ws.wholeFile));
    whole.setAttribute("aria-pressed", String(ws.wholeFile));
    grid?.setAttribute("aria-pressed", String(ws.gridShown));
    const shown = ws.mode !== "code";
    eye.setAttribute("aria-pressed", String(shown));
    eye.title = shown ? "Hide the preview" : "Show the preview";
    eye.querySelector("svg")?.replaceWith(...renderSvg(shown ? "eye" : "eye-closed"));
  };
  const setHeaderMode = header.setMode;
  header.setMode = (mode) => { setHeaderMode(mode); update(); };
  update();
  return renderElement("div", { class: "dw-view-controls" },
    renderElement("div", { class: "dw-modes", role: "group", "aria-label": "Code" }, bySlide, whole),
    renderElement("div", { class: "dw-modes", role: "group", "aria-label": "View" }, ...(grid ? [grid] : []), eye));
}

/** The nodes of an icon's markup. */
function renderSvg(icon: "eye" | "eye-closed"): Node[] {
  const holder = document.createElement("span");
  holder.innerHTML = renderIcon(icon);
  return [...holder.childNodes];
}

/**
 * Splits the header and the insert bar into one bar inside each window. The code's bar holds what writes the code: Slide or Block | File,
 * New slide or Block, the elements and Layout, Build (its errors are in the code) and the eye; the preview's holds what concerns the page:
 * Grid, Aspect ratio or Size, Style (and Poster), Export and Present or Real size. With the preview hidden, Export and Present move to the
 * code's bar so they stay at hand.
 */
function placePaneBars(ws: WorkspaceState, parts: { header: WorkspaceUi["header"]; insert: HTMLElement; editor: HTMLElement; stage: HTMLElement }): void {
  const { header, insert, editor, stage } = parts;
  const head = header.element;
  const [codeGroup, viewGroup] = [...head.querySelectorAll<HTMLElement>(".dw-view-controls > .dw-modes")];
  const eye = viewGroup?.querySelector<HTMLElement>(".dw-eye");
  const gridButton = viewGroup?.querySelector<HTMLElement>('[aria-label="Grid"]');
  const shape = insert.querySelector<HTMLElement>(`[aria-label="${ws.kind === "talk" ? "Aspect ratio" : "Size"}"]`);
  const groups = [...insert.querySelectorAll<HTMLElement>(".dw-insert-group")];
  // The elements show as icons: the code's window is half the width.
  groups[1]?.classList.add("dw-icon-only");
  const ends = [...insert.children].filter((child) => !child.classList.contains("dw-insert-group") && !child.classList.contains("dw-spacer")) as HTMLElement[];
  const shows = [...head.querySelectorAll<HTMLElement>(".dw-header-button")];
  const build = head.querySelector<HTMLElement>(".dw-build");
  const codeEnd = renderElement("div", { class: "dw-pane-end" });
  const codeBar = renderElement("div", { class: "dw-pane-bar dw-code-bar", role: "toolbar", "aria-label": "Code" },
    ...(codeGroup ? [codeGroup] : []), ...groups, renderElement("span", { class: "dw-spacer" }), ...(build ? [build] : []), codeEnd, ...(eye ? [eye] : []));
  const stageEnd = renderElement("div", { class: "dw-pane-end" }, ...shows);
  const stageBar = renderElement("div", { class: "dw-pane-bar dw-stage-bar", role: "toolbar", "aria-label": "Preview" },
    ...(gridButton ? [gridButton] : []), ...(shape ? [shape] : []), renderElement("span", { class: "dw-spacer" }), ...ends, stageEnd);
  editor.prepend(codeBar);
  stage.parentElement?.prepend(stageBar);
  const place = (): void => { (ws.mode === "code" ? codeEnd : stageEnd).append(...shows); };
  const setHeaderMode = header.setMode;
  header.setMode = (mode) => { setHeaderMode(mode); place(); };
  place();
}

/** Builds the workspace's elements and panels in the shell mounted in `host`; their callbacks act on `ws`, whose `ui` is filled with the result. */
export function buildUi(ws: WorkspaceState, host: HTMLElement): WorkspaceUi {
  const { kind, ports } = ws;
  const header = createShellHeader({
    title: ws.name, badge: ws.format === "latex" ? "LaTeX" : "Typst", modes: [], onMode: (next) => setMode(ws, next),
    build: { run: () => ports.build.run(), showProblems: () => ports.showProblems() },
    show: kind === "talk" ? { label: "Present", icon: "play", run: () => ports.present() } : { label: "Real size", icon: "eye", run: () => ports.posterPreview() },
    exports: [{ label: "PDF", icon: "download", run: () => ports.exportPdf() }],
  });
  header.element.prepend(viewControls(ws, header));
  const style = createStyleToggle(ws);
  let zoomBar: ShellZoomBar | undefined;
  let poster: WorkspacePoster | undefined;
  const stage = createStage(ports, (point) => void pick(ws, point), () => void drawOutlines(ws), () => zoomBar?.render(),
    ports.dropImage ? (drop, point) => void dropFigure(ws, drop, point) : undefined);
  if (kind === "poster") { poster = createWorkspacePoster(ws, style.button); stage.onHover((point) => void hover(ws, point)); }
  const bar = buildInsertBar(ws, poster ? [style.button, poster.button] : [style.button]);
  const insertBar = { element: bar.element, refresh: () => { bar.refresh(); style.render(); } };
  const structure = createStructurePanel(kind, { select: (path) => select(ws, path, true), selectPreamble: () => selectPreamble(ws), newSlide: (layout) => newSlide(ws, layout), newBlock: (layout) => newBlock(ws, layout), pageOfSlide: (slide) => ws.linking.pageOfSlide(slide),
    overflowOfSlide: (slide) => ws.overflow?.has(slide) ?? false, overflowOfBlock: (column, block) => ws.posterOverflow?.has(`${column}.${block}`) ?? false,
    ...(ports.dropImage ? { dropImage: (path: SourceDeckPath, drop: FileDrop) => void dropFigure(ws, drop, path) } : {}) });
  const actionBar = createActionBar((action) => act(ws, action));
  const target = zoomTarget(ws, stage);
  // Talks get no Zoom to section.
  const { zoomToRect: _zoomToRect, ...talkSurface } = stage.surface;
  const surface = kind === "poster" ? stage.surface : talkSurface;
  // A talk or poster is edited in its code: the page only zooms, and a click goes to the slide's or block's code.
  zoomBar = createZoomBar(surface, kind === "poster" ? { section: target, tools: false } : { tools: false });
  if (kind === "poster") { mountMinimap(ws, stage); stage.onView(() => zoomBar?.render()); }
  const props = createPropertiesPanel({
    write: (prop, value) => writeProp(ws, prop, value), action: (action) => act(ws, action), columns: () => ws.tree.filter((n) => n.kind === "column").length,
    ...(ports.pickImage ? { replaceImage: () => void ports.pickImage!().then((src) => { if (src) writeProp(ws, "src", src); }) } : {}),
  });
  const { notes, notesPanel } = buildNotes(ws);
  const grid = kind === "talk" ? buildGrid(ws) : undefined;
  const status = createShellStatus();
  const shell = mountDeckShell(host, {
    format: ws.format, kind, header: header.element, insert: insertBar.element, left: structure.element, stage: stage.element, zoom: zoomBar.element,
    props: props.element, status: status.element, code: ports.editor, ...(kind === "talk" ? { notes: notesPanel } : {}), ...(grid ? { grid: grid.element } : {}),
  });
  const { root } = shell;
  placePaneBars(ws, { header, insert: insertBar.element, editor: ports.editor, stage: stage.element });
  const destroyShell = shell.destroy;
  shell.destroy = () => { style.destroy(); poster?.destroy(); destroyShell(); };
  // Focusable, so a click anywhere in the workspace keeps its keys.
  root.tabIndex = -1;
  const unbindKeys = bindShellKeys(root, keyActions(ws, zoomBar, stage, target));
  return { root, shell, unbindKeys, header, insertBar, structure, actionBar, stage, ...(poster ? { poster } : {}), props, notes, status };
}
