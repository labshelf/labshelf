// The deck workspace around the bare deck editor: header, insert bar, the left panel, the stage with its zoom bar, floating bar and
// a poster's rulers, a talk's speaker notes, the properties panel and the status bar; all redrawn from the editor's view.
import { renderElement, renderIcon } from "../../../ui/dom/index.js";
import { setDeckSlideNotes } from "../../deckBlocks.js";
import { openDeckEditor } from "../deckEditorMount.js";
import type { DeckEditorView } from "../deckEditorCore.js";
import { createShellHeader, createShellInsertBar, createShellStatus } from "./chrome.js";
import { createLeftPanel } from "./left.js";
import { createPropertiesPanel } from "./props.js";
import { createFloatingBar, createRulers, createZoomBar } from "./stageTools.js";
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

const EMPTY_VIEW: DeckEditorView = { html: "", theme: "", model: undefined, slide: 0, blocks: [], readOnly: false, scale: 1, notice: "", canUndo: false, canRedo: false, errors: [] };

/** The parts built once the editor has drawn its first view, and the render that redraws them all. */
function buildParts(ctx: ShellContext, root: HTMLElement, centre: HTMLElement, state: { saved: boolean }): { render(): void; destroy(): void } {
  const header = createShellHeader(ctx, () => header.setCode(ctx.editor.toggleSource()));
  const insert = createShellInsertBar(ctx);
  const left = createLeftPanel(ctx);
  const props = createPropertiesPanel(ctx);
  const zoom = createZoomBar(ctx);
  const floating = createFloatingBar(ctx);
  const rulers = ctx.view.model?.kind === "poster" ? createRulers(ctx) : undefined;
  const notes = createNotes(ctx);
  const status = createShellStatus(ctx);
  centre.classList.toggle("has-rulers", rulers !== undefined);
  centre.append(...(rulers ? [rulers.element] : []), zoom.element, floating.element);
  const column = renderElement("div", { class: "dw-stage-column dsh-column" }, centre, notes.element);
  root.append(header.element, insert.element, renderElement("div", { class: "dw-body" }, left.element, column, props.element), status.element);
  const onScroll = (): void => { floating.render(); rulers?.render(); };
  ctx.editor.viewport.addEventListener("scroll", onScroll, { passive: true });
  const render = (): void => {
    header.setSaved(state.saved);
    insert.refresh(); left.render(); props.render(); zoom.render(); notes.render(); status.render(state.saved);
    requestAnimationFrame(onScroll);
  };
  return { render, destroy: () => { left.destroy(); for (const popover of insert.popovers) popover.destroy(); } };
}

/** Opens the deck workspace in `host`: the deck editor in a layout like the talk and poster workspace of LaTeX and Typst sources. */
export function openDeckWorkspace(host: HTMLElement, options: DeckWorkspaceOptions): DeckWorkspaceController {
  const root = renderElement("div", { class: "dw dsh", "data-mode": "visual" });
  const centre = renderElement("div", { class: "dsh-centre" });
  host.append(root);
  const state = { saved: true };
  let parts: ReturnType<typeof buildParts> | undefined;
  const ctx: ShellContext = {
    options, view: EMPTY_VIEW, editor: undefined!,
    edit(steps, label, select) {
      ctx.editor.edit(steps, label);
      if (select) ctx.editor.selectBlocks(select);
    },
  };
  ctx.editor = openDeckEditor(centre, {
    ...options, bare: true,
    onRender(view) {
      ctx.view = view;
      parts?.render();
    },
  });
  parts = buildParts(ctx, root, centre, state);
  parts.render();
  return {
    ...ctx.editor,
    get element() { return root; },
    setSaved(saved) { state.saved = saved; parts?.render(); },
    destroy() {
      parts?.destroy();
      ctx.editor.destroy();
      root.remove();
    },
  };
}
