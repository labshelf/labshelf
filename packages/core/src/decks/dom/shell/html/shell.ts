// The HTML deck in the deck shell: the bare deck editor on the stage with the shell's header, insert bar, zoom bar, status and keys,
// and the HTML parts (left panel, floating bar, a poster's rulers, a talk's speaker notes, properties); all redrawn from the editor's view.
import { renderElement, renderIcon } from "../../../../ui/dom/index.js";
import { setDeckSlideNotes } from "../../../deckBlocks.js";
import { openDeckEditor } from "../../deckEditorMount.js";
import type { DeckEditorView } from "../../deckEditorCore.js";
import { createShellHeader, createShellStatus, createZoomBar, bindShellKeys, mountDeckShell, type DeckShellMode, type ShellKeyActions, type ShellTool, type ShellZoomBar } from "../index.js";
import { deleteSelected, duplicateSelected } from "./actions.js";
import { createHtmlInsertBar, headerSpec, statusParts } from "./chrome.js";
import { createLeftPanel } from "./left.js";
import { createPropertiesPanel } from "./props.js";
import { createFloatingBar, createRulers } from "./stageTools.js";
import type { DeckWorkspaceController, DeckWorkspaceOptions, ShellContext } from "./types.js";

/** The speaker notes under a talk's stage: written when the field loses focus, folded with its heading. */
function createNotes(ctx: ShellContext): { element: HTMLElement; render(): void } {
  const area = renderElement("textarea", { class: "dw-notes-input", placeholder: "Speaker notes for this slide", "aria-label": "Speaker notes" });
  const fold = renderElement("button", { type: "button", class: "dsh-notes-head", "aria-expanded": "true", html: renderIcon("chevron-down") });
  fold.prepend(renderElement("span", { text: "Speaker notes" }));
  const element = renderElement("section", { class: "dw-notes dsh-notes" }, fold, area);
  fold.addEventListener("click", () => { const open = fold.getAttribute("aria-expanded") !== "true"; fold.setAttribute("aria-expanded", String(open)); area.hidden = !open; });
  area.addEventListener("keydown", (event) => event.stopPropagation());
  area.addEventListener("change", () => { const slide = ctx.view.slide; ctx.edit([(html) => setDeckSlideNotes(html, slide, area.value)], "Speaker notes"); });
  return {
    element,
    render() {
      element.hidden = ctx.view.model?.kind === "poster" || ctx.view.readOnly;
      if (document.activeElement !== area) area.value = ctx.view.model?.slides[ctx.view.slide]?.notes?.text ?? "";
    },
  };
}

const EMPTY_VIEW: DeckEditorView = { html: "", theme: "", model: undefined, slide: 0, blocks: [], readOnly: false, scale: 1, fit: true, notice: "", canUndo: false, canRedo: false, errors: [] };

/** The shell's keys over the editor: none while read-only, while a leaf is being edited or during a drag. */
function keyActions(ctx: ShellContext, zoom: ShellZoomBar): ShellKeyActions {
  const idle = (): boolean => !ctx.view.readOnly && !["is-editing", "is-dragging"].some((name) => ctx.editor.element.classList.contains(name));
  let held: ShellTool | undefined;
  const actions: ShellKeyActions = {
    undo: () => ctx.editor.undo(),
    redo: () => ctx.editor.redo(),
    zoomIn: () => zoom.zoomIn(),
    zoomOut: () => zoom.zoomOut(),
    fit: () => zoom.fit(),
    setTool: (tool) => zoom.setTool(tool),
    holdHand(on) {
      if (on && held === undefined) { held = zoom.tool(); zoom.setTool("hand"); } else if (!on && held !== undefined) { zoom.setTool(held); held = undefined; }
    },
    previous: () => ctx.editor.selectSlide(ctx.view.slide - 1),
    next: () => ctx.editor.selectSlide(ctx.view.slide + 1),
    deleteSelection: () => deleteSelected(ctx),
    clearSelection: () => ctx.editor.selectBlocks([]),
    duplicate: () => duplicateSelected(ctx),
  };
  if (ctx.view.model?.kind === "poster") { delete actions.previous; delete actions.next; }
  return Object.fromEntries(Object.entries(actions).map(([key, run]) => [key, (...args: unknown[]) => { if (idle() || (key === "holdHand" && args[0] === false)) (run as (...a: unknown[]) => void)(...args); }])) as ShellKeyActions;
}

/** Opens an HTML talk or poster in the deck shell in `host`. */
export function openDeckWorkspace(host: HTMLElement, options: DeckWorkspaceOptions): DeckWorkspaceController {
  const centre = renderElement("div", { class: "dsh-centre" });
  const state = { saved: true };
  let render = (): void => undefined;
  const ctx: ShellContext = {
    options, view: EMPTY_VIEW, editor: undefined!,
    edit(steps, label, select) {
      ctx.editor.edit(steps, label);
      if (select) ctx.editor.selectBlocks(select);
    },
  };
  ctx.editor = openDeckEditor(centre, { ...options, onRender(view) { ctx.view = view; render(); } });
  let mode: DeckShellMode = "visual";
  const setMode = (next: DeckShellMode): void => {
    if ((next === "code") !== (mode === "code")) ctx.editor.toggleSource();
    mode = next;
    header.setMode(next);
    shell.setMode(next);
  };
  const header = createShellHeader(headerSpec(ctx, setMode));
  const insert = createHtmlInsertBar(ctx);
  const left = createLeftPanel(ctx);
  const props = createPropertiesPanel(ctx);
  const zoom = createZoomBar({
    percent: () => ctx.view.scale * 100,
    isFit: () => ctx.view.fit,
    setZoom: (next) => ctx.editor.setZoom(next === "fit" ? "fit" : next / 100),
    setTool: (tool) => ctx.editor.setTool(tool),
  });
  const floating = createFloatingBar(ctx);
  const rulers = ctx.view.model?.kind === "poster" ? createRulers(ctx) : undefined;
  const notes = createNotes(ctx);
  const status = createShellStatus();
  centre.classList.toggle("has-rulers", rulers !== undefined);
  centre.append(...(rulers ? [rulers.element] : []), floating.element);
  const shell = mountDeckShell(host, {
    format: "html", kind: ctx.view.model?.kind ?? "talk",
    header: header.element, insert: insert.element, left: left.element, stage: centre, zoom: zoom.element, props: props.element, status: status.element, notes: notes.element,
  });
  shell.root.classList.add("dsh");
  header.setMode(mode);
  const unbindKeys = bindShellKeys(shell.root, keyActions(ctx, zoom));
  const onScroll = (): void => { floating.render(); rulers?.render(); };
  ctx.editor.viewport.addEventListener("scroll", onScroll, { passive: true });
  render = () => {
    header.setSaved(state.saved);
    insert.refresh(); left.render(); props.render(); zoom.render(); notes.render(); status.set(statusParts(ctx, state.saved));
    requestAnimationFrame(onScroll);
  };
  render();
  return {
    ...ctx.editor,
    get element() { return shell.root; },
    setSaved(saved) { state.saved = saved; render(); },
    destroy() {
      unbindKeys();
      left.destroy();
      for (const popover of insert.popovers) popover.destroy();
      ctx.editor.destroy();
      shell.destroy();
    },
  };
}
