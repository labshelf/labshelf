// Previews LaTeX math as Overleaf does: typeset above the math under the cursor and the math under the mouse, unknown
// commands in red, with a menu to hide it for now or turn it off for good.
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { closeHoverTooltips, EditorView, hoverTooltip, showTooltip, type Tooltip } from "@codemirror/view";
import { findMathSpan, type MathSpan } from "../../../latex/hover/findMathSpan.js";
import { loadCoreMath, renderMathInto } from "../../../qmd/dom/mathView.js";
import { renderIcon } from "../../../ui/icons/index.js";
import { renderElement, showMenu } from "../../../ui/dom/index.js";

/** The host's lasting choice: VS Code keeps it in a setting, the browser in the page's preferences. */
export interface MathPreviewSetting {
  enabled: boolean;
  /** Stores the preview as off; the host says where to turn it back on. */
  disable(): void;
}

interface CursorPreview { tooltip: Tooltip; tex: string; display: boolean }

interface PreviewState {
  preview: CursorPreview | null;
  /** Start of the math hidden for now: the cursor preview stays hidden until the cursor leaves that math. */
  hidden: number | null;
  /** Turned off for good in this editor. */
  off: boolean;
}

const hideForNow = StateEffect.define<null>();
const turnOff = StateEffect.define<null>();

function mathAt(state: EditorState, offset: number): MathSpan | undefined {
  const span = findMathSpan(state.doc.toString(), offset);
  return span && span.tex.trim() !== "" ? span : undefined;
}

/** The typeset math and the ⋯ menu; `hide` hides this preview for now. */
function renderPreview(view: EditorView, span: MathSpan, setting: MathPreviewSetting | undefined, hide: () => void): HTMLElement {
  const math = renderElement("div", { class: "cm-math-preview-math" });
  void renderMathInto(math, span.tex, span.display, loadCoreMath);
  const more = renderElement("button", { class: "cm-math-preview-more", type: "button", title: "Math preview options", "aria-label": "Math preview options", "aria-haspopup": "menu" });
  more.innerHTML = renderIcon("ellipsis");
  // Keeps the editor's focus and cursor, so the preview does not close under the click.
  more.addEventListener("mousedown", (event) => event.preventDefault());
  more.addEventListener("click", () => showMenu(more, [
    { label: "Hide for now", onSelect: hide },
    ...(setting ? [{ label: "Never show", onSelect: () => { setting.disable(); view.dispatch({ effects: turnOff.of(null) }); } }] : []),
  ]));
  return renderElement("div", { class: "cm-math-preview" }, math, more);
}

function cursorPreview(state: EditorState, previous: CursorPreview | null, setting: MathPreviewSetting | undefined): CursorPreview | null {
  const selection = state.selection.main;
  const span = selection.empty ? mathAt(state, selection.head) : undefined;
  if (!span) return null;
  if (previous && previous.tex === span.tex && previous.display === span.display && previous.tooltip.pos === span.start) return previous;
  // Above the math, so the completion list under the cursor never covers it.
  const tooltip: Tooltip = { pos: span.start, end: span.end, above: true, create: (view) => ({ dom: renderPreview(view, span, setting, () => view.dispatch({ effects: hideForNow.of(null) })) }) };
  return { tooltip, tex: span.tex, display: span.display };
}

function previewField(setting: MathPreviewSetting | undefined): StateField<PreviewState> {
  return StateField.define<PreviewState>({
    create: (state) => (setting && !setting.enabled ? { preview: null, hidden: null, off: true } : { preview: cursorPreview(state, null, setting), hidden: null, off: false }),
    update: (value, transaction) => {
      if (value.off || transaction.effects.some((effect) => effect.is(turnOff))) return { preview: null, hidden: null, off: true };
      let hidden = value.hidden === null ? null : transaction.changes.mapPos(value.hidden);
      if (transaction.effects.some((effect) => effect.is(hideForNow))) {
        const head = transaction.state.selection.main.head;
        hidden = mathAt(transaction.state, head)?.start ?? null;
      }
      if (!transaction.docChanged && !transaction.selection && hidden === value.hidden) return value;
      const preview = cursorPreview(transaction.state, value.preview, setting);
      if (hidden !== null && preview?.tooltip.pos !== hidden) hidden = null;
      return { preview: hidden === null ? preview : null, hidden, off: false };
    },
    provide: (field) => showTooltip.compute([field], (state) => state.field(field).preview?.tooltip ?? null),
  });
}

export function createMathPreview(setting?: MathPreviewSetting): Extension {
  const field = previewField(setting);
  return [
    field,
    // The math under the mouse, unless it is already previewed at the cursor.
    hoverTooltip((view, pos) => {
      const { off, preview } = view.state.field(field);
      const span = off ? undefined : mathAt(view.state, pos);
      if (!span || preview?.tooltip.pos === span.start) return null;
      return { pos: span.start, end: span.end, above: true, create: () => ({ dom: renderPreview(view, span, setting, () => view.dispatch({ effects: closeHoverTooltips })) }) };
    }, {
      // Clicking into the hovered math opens its cursor preview, which takes the hover's place instead of stacking on it.
      hideOn: (transaction, tooltip) => transaction.state.field(field).preview?.tooltip.pos === tooltip.pos,
    }),
    EditorView.baseTheme({
      ".cm-math-preview": { display: "flex", alignItems: "flex-start", gap: "4px", padding: "4px 4px 4px 8px", maxWidth: "min(640px, 90vw)" },
      ".cm-math-preview-math": { overflowX: "auto", minWidth: "0" },
      ".cm-math-preview-math svg": { display: "block" },
      ".cm-math-preview-more": {
        flex: "none", display: "inline-flex", padding: "2px", border: "none", borderRadius: "4px", background: "transparent", color: "inherit", cursor: "pointer", opacity: "0.7",
      },
      ".cm-math-preview-more:hover": { opacity: "1", background: "var(--ls-toolbar-hover)" },
    }),
  ];
}
