// The talk and poster workspace around a LaTeX or Typst source editor: Visual (structure, stage, properties), Split (code beside the
// stage, linked both ways) and Code (the editor alone). Every edit it makes goes through the editor as one undo step, and 800 ms after
// the last one it saves and builds, keeping the selection by node path.
import { renderElement, type MenuEntry } from "../../../ui/dom/index.js";
import {
  BLOCK_LAYOUTS, SLIDE_LAYOUTS, deleteSourceDeckNode, duplicateSourceDeckNode, findSourceDeckNode, findSourceDeckPathAt, insertSourceBlock, insertSourceElement,
  insertSourceSlide, listSourceDeckShapes, moveSourceDeckNode, readSourceDeckBlocks, readSourceDeckNotes, readSourceDeckShape, readSourceSlideLayout,
  restoreSourceDeckPath, setSourceDeckProp, setSourceDeckShape, setSourceNote, setSourceSlideLayout, sourceDeckBreadcrumb,
  listSourceDeckThemes, readSourceDeckAccent, readSourceDeckTheme, setSourceDeckAccent, setSourceDeckTheme,
  type DeckKind, type SourceDeckChange, type SourceDeckElementKind, type SourceDeckFormat, type SourceDeckNode, type SourceDeckPath, type SourceDeckPropName,
} from "../../index.js";
import { readDeckKindOf } from "../../../writing/dom/sourceEditor/index.js";
import { createHeader, createInsertBar, createStatusBar, type InsertItem } from "./header.js";
import { createLinking } from "./linking.js";
import { createActionBar, createPropertiesPanel, type NodeAction } from "./propertiesPanel.js";
import { createStage, type StageOutline } from "./stage.js";
import { createStructurePanel } from "./structurePanel.js";
import type { DeckBuildState, DeckWorkspace, DeckWorkspaceMode, DeckWorkspacePorts } from "./types.js";

const BUILD_DELAY_MS = 800;
const CURSOR_DELAY_MS = 120;
const TEXT_DELAY_MS = 150;

const ELEMENTS: ReadonlyArray<{ kind: SourceDeckElementKind; label: string; icon: InsertItem["icon"] }> = [
  { kind: "text", label: "Text", icon: "heading" }, { kind: "figure", label: "Figure", icon: "file-media" }, { kind: "equation", label: "Equation", icon: "sigma" },
  { kind: "table", label: "Table", icon: "table" }, { kind: "list", label: "List", icon: "list" },
];

const debounce = (ms: number, run: () => void): { call(): void; cancel(): void } => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return { call: () => { clearTimeout(timer); timer = setTimeout(run, ms); }, cancel: () => clearTimeout(timer) };
};

/** Mounts the workspace in `host` around the source editor of a talk or poster; undefined when the file is neither. */
export function mountDeckWorkspace(host: HTMLElement, ports: DeckWorkspacePorts): DeckWorkspace | undefined {
  const { editing } = ports;
  const kind: DeckKind | undefined = readDeckKindOf(ports.path, editing.text());
  if (!kind) return undefined;
  const format: SourceDeckFormat = ports.path.endsWith(".typ") ? "typst" : "latex";
  const name = ports.path.split("/").slice(-2, -1)[0] ?? ports.path;

  let text = editing.text();
  let tree: SourceDeckNode[] = readSourceDeckBlocks(format, kind, text);
  let selected: SourceDeckPath = [];
  let mode: DeckWorkspaceMode = ports.mode.read() ?? (tree.some((node) => node.kind !== "code") ? "visual" : "split");
  let sync = true;
  let build: DeckBuildState = { state: "none", errors: 0 };
  let ownEdit = false;
  const linking = createLinking(format, kind, ports.links);

  const selectedNode = (): SourceDeckNode | undefined => findSourceDeckNode(tree, selected);
  const slideIndex = (): number => (kind === "talk" ? selected[0] ?? 0 : 0);

  // ---- Edits

  const buildSoon = debounce(BUILD_DELAY_MS, () => ports.build.run());
  /** Applies a change through the editor (one undo step) and schedules the build; in Visual the hidden editor gives the focus back. */
  function apply(change: SourceDeckChange | null, select?: (next: SourceDeckNode[]) => SourceDeckPath): boolean {
    if (!change || change.text === editing.text()) { if (!change) flash("LabShelf cannot write that here. Edit it in code."); return false; }
    const before = selectedNode();
    ownEdit = true;
    const focused = document.activeElement as HTMLElement | null;
    editing.apply(change);
    if (mode === "visual") focused?.focus?.();
    refreshText();
    selected = select ? select(tree) : restoreSourceDeckPath(tree, selected, before);
    ownEdit = false;
    buildSoon.call();
    render();
    return true;
  }

  const writeProp = (prop: SourceDeckPropName, value: string | number): void => {
    const node = selectedNode();
    if (!node) return;
    const path = [...selected];
    apply(setSourceDeckProp(format, editing.text(), node, prop, value), prop === "column" ? (next) => {
      const column = next[value as number];
      const count = column?.children?.length ?? 0;
      return count ? [value as number, count - 1] : path;
    } : undefined);
  };

  function act(action: NodeAction): void {
    const node = selectedNode();
    if (!node) return;
    if (action === "code") { setMode("split"); editing.select(node.range[0], node.range[1]); return; }
    const current = editing.text();
    if (action === "delete") { apply(deleteSourceDeckNode(current, node), () => selected.slice(0, -1)); return; }
    if (action === "duplicate") { const path = [...selected]; apply(duplicateSourceDeckNode(current, node), () => [...path.slice(0, -1), path.at(-1)! + 1]); return; }
    const parent = selected.length > 1 ? findSourceDeckNode(tree, selected.slice(0, -1)) : undefined;
    const siblings = parent?.children ?? tree;
    const index = selected.at(-1)!;
    const by = action === "up" ? -1 : 1;
    // A poster block at the end of its column moves into the neighbouring column.
    if (kind === "poster" && node.kind === "block" && !siblings[index + by]) {
      const column = selected[0]! + by;
      if (tree[column]?.kind === "column") apply(setSourceDeckProp(format, current, node, "column", column), (next) => [column, Math.max(0, (next[column]?.children?.length ?? 1) - 1)]);
      return;
    }
    const path = [...selected];
    apply(moveSourceDeckNode(current, siblings, index, by), () => [...path.slice(0, -1), index + by]);
  }

  /** The node new elements go after: the selection (Visual), the node at the cursor (Split and Code). */
  function insertTarget(): SourceDeckNode | undefined {
    const path = mode === "visual" ? selected : findSourceDeckPathAt(tree, editing.cursor());
    let node = findSourceDeckNode(tree, path);
    if (node?.kind === "column" || node?.kind === "columns" || node?.kind === "code") node = undefined;
    return node;
  }
  async function insertElement(element: SourceDeckElementKind): Promise<void> {
    const target = insertTarget();
    if (!target) return;
    const src = element === "figure" && ports.pickImage ? await ports.pickImage() : "figure";
    if (src === undefined) return;
    const change = insertSourceElement(format, editing.text(), target, element, src);
    apply(change, (next) => (change ? findSourceDeckPathAt(next, change.cursor - 1) : selected));
  }

  // ---- Layout

  const header = createHeader(kind, format, name, {
    setMode: (next) => setMode(next), build: () => ports.build.run(), showProblems: () => ports.showProblems(),
    exportPdf: () => ports.exportPdf(), present: () => ports.present(), posterPreview: () => ports.posterPreview(),
  });
  const shapes = listSourceDeckShapes(kind, format);
  const shapeMenu: InsertItem = {
    icon: "grid", label: kind === "talk" ? "Aspect ratio" : "Size",
    menu: () => {
      const current = readSourceDeckShape(format, kind, editing.text());
      return shapes.map((choice) => ({ label: choice.label, radio: true, checked: choice.label === current, onSelect: () => { const next = setSourceDeckShape(format, editing.text(), choice.shape); apply(next === null ? null : { text: next, cursor: editing.cursor() }); } }));
    },
  };
  const accents: ReadonlyArray<[string, string]> = [["Blue", "#1f5673"], ["Red", "#a4262c"], ["Green", "#2e7d32"], ["Purple", "#5e35b1"], ["Orange", "#c75b12"], ["Black", "#222222"]];
  const themeMenu: InsertItem = {
    icon: "droplet", label: "Theme",
    disabled: () => (format === "typst" || listSourceDeckThemes(format, editing.text()) ? undefined : "Theme works for beamer and tikzposter sources"),
    menu: () => {
      const current = editing.text();
      if (format === "typst") {
        const accent = readSourceDeckAccent(current);
        return [{ label: "Heading colour", disabled: true, onSelect: () => undefined },
          ...accents.map(([label, hex]) => ({ label, hint: hex, radio: true, checked: accent === hex, onSelect: () => apply(setSourceDeckAccent(editing.text(), hex)) }))];
      }
      const names = listSourceDeckThemes(format, current)!;
      const section = (slot: "theme" | "color", title: string): MenuEntry[] => {
        const chosen = readSourceDeckTheme(format, current, slot);
        return [{ label: title, disabled: true, onSelect: () => undefined },
          ...names[slot].map((name) => ({ label: name, radio: true, checked: chosen === name, onSelect: () => apply(setSourceDeckTheme(format, editing.text(), slot, name)) }))];
      };
      return [...section("theme", "Theme"), "separator", ...section("color", "Colours")];
    },
  };
  const noTarget = (): string | undefined => (insertTarget() ? undefined : kind === "talk" ? "Select a slide or an element first" : "Select a block or an element first");
  const elementItems: InsertItem[] = ELEMENTS.map(({ kind: element, label, icon }) => ({ icon, label, run: () => void insertElement(element), disabled: noTarget }));
  const syncButton = renderElement("label", { class: "dw-check" }, renderElement("input", { type: "checkbox", checked: true }), renderElement("span", { text: "Sync selection" }));
  syncButton.querySelector("input")!.addEventListener("change", (event) => { sync = (event.target as HTMLInputElement).checked; void drawOutlines(); });
  const reveal = renderElement("button", { type: "button", class: "dw-insert", text: "Reveal in preview" });
  reveal.addEventListener("click", () => { cursorMoved(editing.cursor(), true); });
  const insertBar = createInsertBar(kind === "talk" ? [
    [{ icon: "plus", label: "New slide", menu: () => SLIDE_LAYOUTS.map((layout) => ({ label: layout.label, onSelect: () => newSlide(layout.id) })) }],
    elementItems,
    [{
      icon: "layers", label: "Layout",
      disabled: () => { const slide = tree[slideIndex()]; return slide && readSourceSlideLayout(format, editing.text(), slide) ? undefined : "Layout changes a slide whose body is still a starter layout"; },
      menu: () => SLIDE_LAYOUTS.map((layout) => ({ label: layout.label, onSelect: () => { const slide = tree[slideIndex()]; if (slide) apply(setSourceSlideLayout(format, editing.text(), slide, layout.id)); } })),
    }, themeMenu, shapeMenu],
  ] : [
    [{ icon: "plus", label: "Block", menu: () => BLOCK_LAYOUTS.map((layout) => ({ label: layout.label, onSelect: () => newBlock(layout.id) })) }],
    elementItems,
    [themeMenu, shapeMenu],
  ], [syncButton, reveal]);

  function newSlide(layout: (typeof SLIDE_LAYOUTS)[number]["id"]): void {
    const at = kind === "talk" && tree[slideIndex()] ? tree[slideIndex()]!.range[0] : editing.cursor();
    const change = insertSourceSlide(format, editing.text(), mode === "visual" ? at : editing.cursor(), layout);
    apply(change, (next) => findSourceDeckPathAt(next, change.cursor).slice(0, 1));
  }
  function newBlock(layout: (typeof BLOCK_LAYOUTS)[number]["id"]): void {
    const node = mode === "visual" ? findSourceDeckNode(tree, selected.slice(0, 2)) : undefined;
    const at = node && node.kind === "block" ? node.range[1] : editing.cursor();
    const change = insertSourceBlock(format, editing.text(), at, layout);
    apply(change, (next) => findSourceDeckPathAt(next, change.cursor, (n) => n.kind === "block"));
  }

  const structure = createStructurePanel(kind, { select: (path) => select(path, true), newSlide, pageOfSlide: (slide) => linking.pageOfSlide(slide) });
  const actionBar = createActionBar(act);
  const stage = createStage(ports, (point) => void pick(point), () => void drawOutlines());
  const props = createPropertiesPanel({
    write: writeProp, action: act, columns: () => tree.filter((n) => n.kind === "column").length,
    ...(ports.pickImage ? { replaceImage: () => void ports.pickImage!().then((src) => { if (src) writeProp("src", src); }) } : {}),
  });
  const notes = renderElement("textarea", { class: "dw-notes-input", placeholder: "Speaker notes for this slide", "aria-label": "Speaker notes" });
  notes.addEventListener("change", () => { const slide = tree[slideIndex()]; if (slide) apply(setSourceNote(format, editing.text(), slide, notes.value.trim())); });
  const notesPanel = renderElement("section", { class: "dw-notes", hidden: kind !== "talk" }, renderElement("div", { class: "dw-panel-heading", text: "Speaker notes" }), notes);
  const status = createStatusBar();
  const codePane = renderElement("div", { class: "dw-code" }, ports.editor);
  const divider = renderElement("div", { class: "dw-divider", role: "separator", "aria-orientation": "vertical", "aria-label": "Resize" });
  const stageColumn = renderElement("div", { class: "dw-stage-column" }, stage.element, notesPanel);
  const body = renderElement("div", { class: "dw-body" }, structure.element, codePane, divider, stageColumn, props.element);
  const root = renderElement("div", { class: "dw", "data-kind": kind }, header.element, insertBar.element, body, status.element);
  host.append(root);

  divider.addEventListener("pointerdown", (event) => {
    divider.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent): void => { const bounds = body.getBoundingClientRect(); root.style.setProperty("--dw-code-width", `${Math.min(80, Math.max(20, ((e.clientX - bounds.left) / bounds.width) * 100))}%`); };
    const up = (): void => { divider.removeEventListener("pointermove", move); divider.removeEventListener("pointerup", up); };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
  });

  // ---- Selection and drawing

  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  function flash(message: string): void {
    stage.setNote(message);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => stage.setNote(linking.note()), 4000);
  }

  function select(path: SourceDeckPath, fromPanel = false): void {
    selected = path;
    if (fromPanel && mode === "split") { const node = selectedNode(); if (node) editing.reveal(node.range[0]); }
    render();
  }

  /** A click on the page: the block under it, or (when that block is already selected) the element inside it. */
  async function pick(point: { page: number; x: number; y: number }): Promise<void> {
    const container = kind === "talk" ? (n: SourceDeckNode) => n.kind !== "slide" : (n: SourceDeckNode) => n.kind === "block";
    let path = await linking.pathAt(point, tree, kind === "talk" ? () => true : container);
    if (kind === "poster" && path.length >= 2 && selected.length >= 2 && path[0] === selected[0] && path[1] === selected[1]) {
      const inner = await linking.pathAt(point, tree, () => true);
      if (inner.length > 2) path = inner;
    }
    if (kind === "talk" && path.length === 0) path = [linking.slideOfPage(point.page) ?? slideIndex()];
    if (kind === "poster" && path.length === 0) path = selected.slice(0, 1);
    if (mode === "split" && sync) { const node = findSourceDeckNode(tree, path); if (node) editing.reveal(node.range[0]); }
    select(path);
  }

  async function drawOutlines(): Promise<void> {
    const outlines: StageOutline[] = [];
    const page = kind === "talk" ? linking.pageOfSlide(slideIndex()) : 1;
    if (page !== undefined) stage.showPage(page);
    if (stage.guides()) {
      const containers = kind === "talk" ? (tree[slideIndex()]?.children ?? []).map((_, i) => [slideIndex(), i]) : tree.flatMap((column, c) => (column.children ?? []).map((_, b) => [c, b]));
      for (const path of containers) { const rect = await linking.rectOf(path, tree, page); if (rect) outlines.push({ rect, tone: "guide" }); }
    }
    const showSelection = selected.length > 0 && (mode === "visual" || sync) && !(kind === "talk" && selected.length === 1);
    const rect = showSelection ? await linking.rectOf(selected, tree, page) : undefined;
    if (rect) outlines.push({ rect, tone: "selected" });
    stage.setOutlines(outlines);
    stage.placeBar(actionBar, mode === "visual" ? rect : undefined);
    // Asking for a rectangle tells whether SyncTeX places the nodes; the note says when it does not.
    stage.setNote(linking.note());
  }

  function renderStatus(): void {
    const crumb = sourceDeckBreadcrumb(tree, kind!, selected);
    const shape = readSourceDeckShape(format, kind!, text) ?? "";
    const pdf = stage.pdf();
    if (kind === "talk") {
      const slides = tree.filter((n) => n.kind === "slide").length;
      const index = slideIndex();
      status.set({ left: `Slide ${Math.min(index + 1, slides)} of ${slides}${shape ? ` · ${shape}` : ""}`, crumb, nav: { previous: () => select([index - 1]), next: () => select([index + 1]), canPrevious: index > 0, canNext: index + 1 < slides } });
      return;
    }
    const size = pdf?.pageSize(0);
    const mm = size ? ` · ${Math.round((size.width / 72) * 25.4)} × ${Math.round((size.height / 72) * 25.4)} mm` : "";
    status.set({ left: `Poster${shape ? ` · ${shape}` : ""}${mm}`, crumb });
  }

  function render(): void {
    structure.render(tree, selected);
    const node = selectedNode();
    props.render(node, {
      index: selected.at(-1) ?? 0, ...(kind === "poster" && node?.kind === "block" ? { column: selected[0]! } : {}),
      source: node ? text.slice(node.range[0], node.range[1]) : "", linked: linking.linked(), breadcrumb: sourceDeckBreadcrumb(tree, kind!, selected).slice(1),
    });
    if (kind === "talk" && document.activeElement !== notes) notes.value = readSourceDeckNotes(format, text)[slideIndex()] ?? "";
    insertBar.refresh();
    renderStatus();
    void drawOutlines();
  }

  // ---- Modes, text, cursor and builds

  function setMode(next: DeckWorkspaceMode): void {
    mode = next;
    root.dataset["mode"] = next;
    header.setMode(next);
    ports.mode.write(next);
    if (next === "split") cursorMoved(editing.cursor(), true);
    render();
  }

  function refreshText(): void {
    text = editing.text();
    tree = readSourceDeckBlocks(format, kind!, text);
    linking.forget();
  }
  const textChanged = debounce(TEXT_DELAY_MS, () => {
    if (ownEdit) return;
    const before = selectedNode();
    refreshText();
    selected = restoreSourceDeckPath(tree, selected, before);
    render();
  });

  function cursorMoved(offset: number, force = false): void {
    if (mode !== "split" || (!sync && !force)) return;
    const path = findSourceDeckPathAt(tree, offset);
    if (path.join() === selected.join() && !force) return;
    selected = path;
    render();
  }
  const cursorSoon = { offset: 0, timer: debounce(CURSOR_DELAY_MS, () => cursorMoved(cursorSoon.offset)) };

  const unsubscribe = ports.subscribe({
    text: () => textChanged.call(),
    cursor: (offset) => { cursorSoon.offset = offset; cursorSoon.timer.call(); },
  });

  const emptyStage = (): HTMLElement => {
    const button = renderElement("button", { type: "button", class: "dw-button", text: "Build" });
    button.addEventListener("click", () => ports.build.run());
    return renderElement("div", { class: "dw-empty-card" }, renderElement("p", { text: build.state === "building" ? "Compiling the PDF…" : "No PDF yet. Build the file to see it here." }), ...(build.state === "building" ? [] : [button]));
  };
  async function reload(): Promise<void> {
    const loaded = await stage.load().catch(() => false);
    stage.setEmpty(loaded ? null : emptyStage());
    await linking.reset(stage.pdf(), tree, text);
    structure.setPdf(stage.pdf());
    stage.setNote(linking.note());
    render();
  }
  const stopBuild = ports.build.onState((next) => {
    const finished = build.state === "building" && next.state !== "building";
    build = next;
    header.setBuild(next);
    if (next.state === "succeeded" && (finished || !stage.pdf())) void reload();
    else if (!stage.pdf()) stage.setEmpty(emptyStage());
  });

  setMode(mode);
  void reload();

  return {
    mode: () => mode,
    setMode,
    dispose() {
      unsubscribe(); stopBuild(); buildSoon.cancel(); textChanged.cancel(); cursorSoon.timer.cancel(); stage.dispose();
      root.remove();
    },
  };
}
