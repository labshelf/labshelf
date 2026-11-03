// The workspace's UI: the header, the insert bar with its Theme, Size and Layout menus, the panels, the stage and the layout around them.
import { renderElement, type MenuEntry } from "../../../ui/dom/index.js";
import {
  BLOCK_LAYOUTS, SLIDE_LAYOUTS, listSourceDeckShapes, listSourceDeckThemes, readSourceDeckAccent, readSourceDeckShape, readSourceDeckTheme, readSourceSlideLayout,
  setSourceDeckAccent, setSourceDeckShape, setSourceDeckTheme, setSourceNote, setSourceSlideLayout, type SourceDeckElementKind,
} from "../../index.js";
import { createHeader, createInsertBar, createStatusBar, type InsertItem } from "./header.js";
import { createActionBar, createPropertiesPanel } from "./propertiesPanel.js";
import { createStage } from "./stage.js";
import { createStructurePanel } from "./structurePanel.js";
import { act, apply, insertElement, insertTarget, newBlock, newSlide, writeProp } from "./workspaceEdits.js";
import { cursorMoved, drawOutlines, pick, select, setMode } from "./workspaceView.js";
import { slideIndex, type WorkspaceState, type WorkspaceUi } from "./workspaceState.js";

const ELEMENTS: ReadonlyArray<{ kind: SourceDeckElementKind; label: string; icon: InsertItem["icon"] }> = [
  { kind: "text", label: "Text", icon: "heading" }, { kind: "figure", label: "Figure", icon: "file-media" }, { kind: "equation", label: "Equation", icon: "sigma" },
  { kind: "table", label: "Table", icon: "table" }, { kind: "list", label: "List", icon: "list" },
];
const ACCENTS: ReadonlyArray<[string, string]> = [["Blue", "#1f5673"], ["Red", "#a4262c"], ["Green", "#2e7d32"], ["Purple", "#5e35b1"], ["Orange", "#c75b12"], ["Black", "#222222"]];

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

/** The Theme menu: the heading colour for Typst, the beamer or tikzposter theme and colours for LaTeX. */
function themeMenu(ws: WorkspaceState): InsertItem {
  const { format } = ws;
  const { editing } = ws.ports;
  return {
    icon: "droplet", label: "Theme",
    disabled: () => (format === "typst" || listSourceDeckThemes(format, editing.text()) ? undefined : "Theme works for beamer and tikzposter sources"),
    menu: () => {
      const current = editing.text();
      if (format === "typst") {
        const accent = readSourceDeckAccent(current);
        return [{ label: "Heading colour", disabled: true, onSelect: () => undefined },
          ...ACCENTS.map(([label, hex]) => ({ label, hint: hex, radio: true, checked: accent === hex, onSelect: () => apply(ws, setSourceDeckAccent(editing.text(), hex)) }))];
      }
      const names = listSourceDeckThemes(format, current)!;
      const section = (slot: "theme" | "color", title: string): MenuEntry[] => {
        const chosen = readSourceDeckTheme(format, current, slot);
        return [{ label: title, disabled: true, onSelect: () => undefined },
          ...names[slot].map((name) => ({ label: name, radio: true, checked: chosen === name, onSelect: () => apply(ws, setSourceDeckTheme(format, editing.text(), slot, name)) }))];
      };
      return [...section("theme", "Theme"), "separator", ...section("color", "Colours")];
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

/** The insert bar: slides or blocks, elements, theme and size, then Sync selection and Reveal in preview. */
function buildInsertBar(ws: WorkspaceState): WorkspaceUi["insertBar"] {
  const { kind } = ws;
  const { editing } = ws.ports;
  const noTarget = (): string | undefined => (insertTarget(ws) ? undefined : kind === "talk" ? "Select a slide or an element first" : "Select a block or an element first");
  const elementItems: InsertItem[] = ELEMENTS.map(({ kind: element, label, icon }) => ({ icon, label, run: () => void insertElement(ws, element), disabled: noTarget }));
  const syncButton = renderElement("label", { class: "dw-check" }, renderElement("input", { type: "checkbox", checked: true }), renderElement("span", { text: "Sync selection" }));
  syncButton.querySelector("input")!.addEventListener("change", (event) => { ws.sync = (event.target as HTMLInputElement).checked; void drawOutlines(ws); });
  const reveal = renderElement("button", { type: "button", class: "dw-insert", text: "Reveal in preview" });
  reveal.addEventListener("click", () => { cursorMoved(ws, editing.cursor(), true); });
  return createInsertBar(kind === "talk" ? [
    [{ icon: "plus", label: "New slide", menu: () => SLIDE_LAYOUTS.map((layout) => ({ label: layout.label, onSelect: () => newSlide(ws, layout.id) })) }],
    elementItems,
    [layoutMenu(ws), themeMenu(ws), shapeMenu(ws)],
  ] : [
    [{ icon: "plus", label: "Block", menu: () => BLOCK_LAYOUTS.map((layout) => ({ label: layout.label, onSelect: () => newBlock(ws, layout.id) })) }],
    elementItems,
    [themeMenu(ws), shapeMenu(ws)],
  ], [syncButton, reveal]);
}

/** The speaker notes box under a talk's stage. */
function buildNotes(ws: WorkspaceState): { notes: HTMLTextAreaElement; notesPanel: HTMLElement } {
  const notes = renderElement("textarea", { class: "dw-notes-input", placeholder: "Speaker notes for this slide", "aria-label": "Speaker notes" });
  notes.addEventListener("change", () => { const slide = ws.tree[slideIndex(ws)]; if (slide) apply(ws, setSourceNote(ws.format, ws.ports.editing.text(), slide, notes.value.trim())); });
  const notesPanel = renderElement("section", { class: "dw-notes", hidden: ws.kind !== "talk" }, renderElement("div", { class: "dw-panel-heading", text: "Speaker notes" }), notes);
  return { notes, notesPanel };
}

/** Dragging the divider resizes the code pane. */
function wireDivider(divider: HTMLElement, body: HTMLElement, root: HTMLElement): void {
  divider.addEventListener("pointerdown", (event) => {
    divider.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent): void => { const bounds = body.getBoundingClientRect(); root.style.setProperty("--dw-code-width", `${Math.min(80, Math.max(20, ((e.clientX - bounds.left) / bounds.width) * 100))}%`); };
    const up = (): void => { divider.removeEventListener("pointermove", move); divider.removeEventListener("pointerup", up); };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
  });
}

/** Builds the workspace's elements and panels; their callbacks act on `ws`, whose `ui` is filled with the result. */
export function buildUi(ws: WorkspaceState): WorkspaceUi {
  const { kind, ports } = ws;
  const header = createHeader(kind, ws.format, ws.name, {
    setMode: (next) => setMode(ws, next), build: () => ports.build.run(), showProblems: () => ports.showProblems(),
    exportPdf: () => ports.exportPdf(), present: () => ports.present(), posterPreview: () => ports.posterPreview(),
  });
  const insertBar = buildInsertBar(ws);
  const structure = createStructurePanel(kind, { select: (path) => select(ws, path, true), newSlide: (layout) => newSlide(ws, layout), pageOfSlide: (slide) => ws.linking.pageOfSlide(slide) });
  const actionBar = createActionBar((action) => act(ws, action));
  const stage = createStage(ports, (point) => void pick(ws, point), () => void drawOutlines(ws));
  const props = createPropertiesPanel({
    write: (prop, value) => writeProp(ws, prop, value), action: (action) => act(ws, action), columns: () => ws.tree.filter((n) => n.kind === "column").length,
    ...(ports.pickImage ? { replaceImage: () => void ports.pickImage!().then((src) => { if (src) writeProp(ws, "src", src); }) } : {}),
  });
  const { notes, notesPanel } = buildNotes(ws);
  const status = createStatusBar();
  const divider = renderElement("div", { class: "dw-divider", role: "separator", "aria-orientation": "vertical", "aria-label": "Resize" });
  const body = renderElement("div", { class: "dw-body" }, structure.element, renderElement("div", { class: "dw-code" }, ports.editor), divider,
    renderElement("div", { class: "dw-stage-column" }, stage.element, notesPanel), props.element);
  const root = renderElement("div", { class: "dw", "data-kind": kind }, header.element, insertBar.element, body, status.element);
  wireDivider(divider, body, root);
  return { root, header, insertBar, structure, actionBar, stage, props, notes, status };
}
