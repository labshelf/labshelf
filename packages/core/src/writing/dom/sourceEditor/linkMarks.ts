// What the source editor's linked copies share, notes' equations and code listings alike: the state marks with their hover, the refresh where the last call wins, the guard of an action, the insert on lines of its own and the side-by-side dialog.
// CONTRACT: documents/contracts/qmd-items.md#manuscript-links
import { StateEffect, StateField, type Extension, type StateEffectType, type Text } from "@codemirror/state";
import { Decoration, EditorView, hoverTooltip, type Tooltip } from "@codemirror/view";
import { formatError, type ILogger, type OriginState } from "../../../index.js";
import { mountOverlay, renderElement, showToast } from "../../../ui/dom/index.js";

/** A mark over a link comment whose copy is not fresh. */
export interface LinkMark { from: number; to: number; state: Exclude<OriginState, "fresh">; sentence: string }

/** A button of a mark's hover. */
export interface LinkButton { label: string; primary: boolean; run(): Promise<void> }

interface LinkMarks {
  /** The marks field, its decorations, its hover and the look they share. */
  extension: Extension;
  /** Replaces the marks of `view`. */
  set(view: EditorView, marks: readonly LinkMark[]): void;
}

/** The look of the marks and of the hover; output links share it. */
export const linkTheme = EditorView.theme({
  ".ls-origin-stale": { textDecoration: "underline dotted var(--ls-mark-accent)" },
  ".ls-origin-diverged, .ls-origin-both, .ls-origin-missing": { textDecoration: "underline wavy var(--ls-warning)" },
  ".ls-origin-tip": {
    display: "flex", flexDirection: "column", gap: "var(--ls-space-2)", maxWidth: "min(32em, 90vw)", boxSizing: "border-box", padding: "var(--ls-space-3)",
    backgroundColor: "var(--ls-widget-bg)", color: "var(--ls-menu-fg)", border: "1px solid var(--ls-menu-border)", borderRadius: "var(--ls-radius)",
    boxShadow: "var(--ls-widget-shadow)", fontFamily: "var(--ls-font)", fontSize: "var(--ls-text-sm)",
  },
  ".ls-origin-tip .ls-dialog-msg": { margin: "0" },
  ".ls-origin-tip-actions": { display: "flex", flexWrap: "wrap", gap: "var(--ls-space-2)" },
});

/** A 0-based line and character as a document offset, clamped to the document's lines. */
export function toOffset(doc: Text, position: { line: number; character: number }): number {
  return doc.line(Math.min(Math.max(position.line + 1, 1), doc.lines)).from + position.character;
}

/** A field of marks over ranges of the text and the effect that replaces them all. */
export function createMarksField<M extends { from: number; to: number }>(): { replace: StateEffectType<readonly M[]>; field: StateField<readonly M[]> } {
  const replace = StateEffect.define<readonly M[]>();
  // INVARIANT: marks are kept in document offsets and mapped through edits; an edit that deletes a mark leaves it empty and it is not drawn.
  const field = StateField.define<readonly M[]>({
    create: () => [],
    update(value, transaction) {
      for (const effect of transaction.effects) if (effect.is(replace)) return effect.value;
      if (!transaction.docChanged) return value;
      return value.map((mark) => ({ ...mark, from: transaction.changes.mapPos(mark.from, 1), to: transaction.changes.mapPos(mark.to, -1) }));
    },
  });
  return { replace, field };
}

/** The marks of one kind of link; `buttonsFor` gives the hover's actions for a mark on a 0-based line. */
function createLinkMarks(buttonsFor: (view: EditorView, mark: LinkMark, line: number) => LinkButton[], guarded: Guard): LinkMarks {
  const { replace, field } = createMarksField<LinkMark>();
  const decorations = EditorView.decorations.compute([field], (state) =>
    Decoration.set(
      state.field(field)
        .filter((mark) => mark.to > mark.from && mark.from >= 0 && mark.to <= state.doc.length)
        .map((mark) => Decoration.mark({ class: `ls-origin-mark ls-origin-${mark.state}`, attributes: { title: mark.sentence } }).range(mark.from, mark.to)),
      true,
    ));
  const hover = hoverTooltip((view, pos): Tooltip | null => {
    const mark = view.state.field(field).find((candidate) => candidate.to > candidate.from && pos >= candidate.from && pos <= candidate.to);
    return mark ? tooltipFor(mark, buttonsFor(view, mark, view.state.doc.lineAt(mark.from).number - 1), guarded) : null;
  });
  return { extension: [field, decorations, hover, linkTheme], set: (view, marks) => view.dispatch({ effects: replace.of(marks) }) };
}

/** The tooltip over a mark: what its state means, with the actions that fit it. */
function tooltipFor(mark: LinkMark, buttons: readonly LinkButton[], guarded: Guard): Tooltip {
  return {
    pos: mark.from, end: mark.to, above: true,
    create: () => {
      const dom = renderElement("div", { class: "ls-origin-tip" }, renderElement("p", { class: "ls-dialog-msg", text: mark.sentence }));
      if (buttons.length > 0) {
        dom.append(renderElement("div", { class: "ls-origin-tip-actions" }, ...buttons.map(({ label, primary, run }) => {
          const button = renderElement("button", { type: "button", class: primary ? "ls-btn ls-btn-primary" : "ls-btn", text: label });
          button.addEventListener("click", () => void guarded.run(run));
          return button;
        })));
      }
      return { dom };
    },
  };
}

/** Runs an action; whatever it throws is logged and shown. `run` uses the guard's own action name for the hover's buttons. */
export interface Guard {
  (action: string, run: () => Promise<void>): Promise<void>;
  run(run: () => Promise<void>): Promise<void>;
}

/** @param hoverAction what the hover's buttons say they could not do, as "read the equation" */
export function createGuard(logger: ILogger, module: string, hoverAction: string): Guard {
  const guarded = async (action: string, run: () => Promise<void>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      void logger.error(module, error, { action });
      showToast(`Could not ${action}: ${formatError(error)}`, "error");
    }
  };
  return Object.assign(guarded, { run: (run: () => Promise<void>) => guarded(hoverAction, run) });
}

/**
 * Recomputes the marks of a view: `compute` reads the text it is given; a later call for the same view wins over an earlier one still reading,
 * and a text that moved on while reading is read again. Resolves when this call is done.
 */
export function createLinkRefresh<M>(
  compute: (text: string, doc: Text) => Promise<readonly M[]>, marks: { set(view: EditorView, marks: readonly M[]): void }, isClosed: () => boolean, onError: (error: unknown) => void,
): (view: EditorView) => Promise<void> {
  const requests = new WeakMap<EditorView, number>();
  const refresh = async (view: EditorView): Promise<void> => {
    const mine = (requests.get(view) ?? 0) + 1;
    requests.set(view, mine);
    const doc = view.state.doc;
    try {
      const next = await compute(doc.toString(), doc);
      if (isClosed() || requests.get(view) !== mine) return;
      // The text moved on while the sources were read: positions would not fit, so read again.
      if (view.state.doc !== doc) { await refresh(view); return; }
      marks.set(view, next);
    } catch (error) {
      onError(error);
    }
  };
  return refresh;
}

/** Line breaks as the document writes them, since CodeMirror splits an inserted string only on its own line separator. */
const withLineBreaks = (view: EditorView, text: string): string => text.replace(/\n/g, view.state.lineBreak);

/** Puts `block` at the selection, on lines of its own. */
export function insertBlock(view: EditorView, block: string): void {
  const { doc, selection } = view.state;
  const { from, to } = selection.main;
  const before = doc.sliceString(doc.lineAt(from).from, from).trim() !== "";
  const after = doc.sliceString(to, doc.lineAt(to).to).trim() !== "";
  const text = withLineBreaks(view, `${before ? "\n" : ""}${block}${after ? "\n" : ""}`);
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length - (after ? view.state.lineBreak.length : 0) }, scrollIntoView: true, userEvent: "input" });
  view.focus();
}

/** Replaces a line/character range with `text` (LF), as one input edit. */
export function applyRangeEdit(view: EditorView, doc: Text, edit: { range: { start: { line: number; character: number }; end: { line: number; character: number } }; text: string }): void {
  view.dispatch({ changes: { from: toOffset(doc, edit.range.start), to: toOffset(doc, edit.range.end), insert: withLineBreaks(view, edit.text) }, userEvent: "input" });
}

export interface DiffDialog {
  view: EditorView;
  title: string;
  subtitle: string;
  /** The two columns: the manuscript's copy first, then its source's. */
  columns: readonly [{ heading: string; text: string }, { heading: string; text: string }];
  /** The label of the update button, shown only with `update`. */
  updateLabel: string;
  /** Present only for a stale copy: applies the update. */
  update: (() => void) | undefined;
}

/** A read-only dialog with the two texts side by side; nothing is written unless the stale copy's update is chosen. */
export function openDiffDialog({ view, title, subtitle, columns, updateLabel, update }: DiffDialog): void {
  const column = ({ heading, text }: { heading: string; text: string }): HTMLElement =>
    renderElement("div", { class: "ls-origin-diff-col" }, renderElement("h3", { text: heading }), renderElement("pre", { text }));
  const heading = renderElement("div", { class: "ls-dialog-title", id: "ls-origin-diff-title", text: title });
  const close = renderElement("button", { type: "button", class: "ls-btn", text: "Close" });
  const actions = renderElement("div", { class: "ls-dialog-actions" }, close);
  const dialog = renderElement("div", { class: "ls-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": heading.id },
    renderElement("div", { class: "ls-dialog-head" }, renderElement("div", {}, heading, renderElement("p", { class: "ls-dialog-msg", text: subtitle }))),
    renderElement("div", { class: "ls-origin-diff" }, column(columns[0]), column(columns[1])),
    actions);
  const dismiss = (): void => { overlay.close(); view.focus(); };
  const overlay = mountOverlay(dialog, dismiss);
  close.addEventListener("click", dismiss);
  if (update) {
    const apply = renderElement("button", { type: "button", class: "ls-btn ls-btn-primary", text: updateLabel });
    apply.addEventListener("click", () => { dismiss(); update(); });
    actions.append(apply);
  }
  close.focus();
}

/** The deps, the refresh of the marks and the guard every action of one kind of link shares. */
export interface LinkRuntime<D> { deps: D; refresh(view: EditorView): Promise<void>; guarded: Guard }

/** What the editor's actions of one kind of link run; each acts on the editor it was made for. */
export interface LinkActions {
  insert(): Promise<void>;
  update(): Promise<void>;
  showDifferences(): Promise<void>;
}

/** One kind of link wired into an editor: the marks, their refresh and the actions. */
export interface LinkController {
  extension: Extension;
  /** Recomputes the state of every link; a later call wins over an earlier one still reading. Resolves when this call is done. */
  refresh(view: EditorView): Promise<void>;
  /** Stops the refreshes that are still reading. */
  close(): void;
  actionsFor(view: EditorView): LinkActions;
}

/** What differs between kinds of link: what a mark is computed from, its buttons and the three actions. */
export interface LinkKind<D> {
  module: string;
  /** Named in the error a failed action shows: "read the equation". */
  subject: string;
  refreshAction: string;
  compute(rt: LinkRuntime<D>, text: string, doc: Text): Promise<readonly LinkMark[]>;
  buttonsFor(rt: LinkRuntime<D>): (view: EditorView, mark: LinkMark, line: number) => LinkButton[];
  insert(rt: LinkRuntime<D>, view: EditorView): Promise<void>;
  /** Runs `act` on the link under the cursor. */
  atCursor(rt: LinkRuntime<D>, view: EditorView, act: (line: number) => Promise<void>): Promise<void>;
  update(rt: LinkRuntime<D>, view: EditorView, line: number): Promise<void>;
  showDiff(rt: LinkRuntime<D>, view: EditorView, line: number): Promise<void>;
}

export function createLinkController<D extends { logger: ILogger }>(deps: D, kind: LinkKind<D>): LinkController {
  let closed = false;
  const rt: LinkRuntime<D> = { deps, refresh: async () => undefined, guarded: createGuard(deps.logger, kind.module, kind.subject) };
  const marks = createLinkMarks(kind.buttonsFor(rt), rt.guarded);
  rt.refresh = createLinkRefresh((text, doc) => kind.compute(rt, text, doc), marks, () => closed,
    (error) => void deps.logger.error(kind.module, error, { action: kind.refreshAction }));
  return {
    extension: marks.extension,
    refresh: (view) => rt.refresh(view),
    close() { closed = true; },
    actionsFor: (view) => ({
      insert: () => kind.insert(rt, view),
      update: () => kind.atCursor(rt, view, (line) => kind.update(rt, view, line)),
      showDifferences: () => kind.atCursor(rt, view, (line) => kind.showDiff(rt, view, line)),
    }),
  };
}
