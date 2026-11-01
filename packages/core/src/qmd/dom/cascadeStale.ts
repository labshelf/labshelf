// Cascading staleness (plan D7): when a cell is edited or rerun, the later cells of the same language whose output ran before the change are marked
// "May be out of date" with Run below. View only: the plugin state is not in the document, so the serialised body is byte-identical.
import type { Node as ProseNode } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { renderElement } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import type { CellRunInfo } from "../compute/index.js";
import { fenceCellLanguage } from "./inlineViews.js";

/** A change to a cell, in the plugin state: where it is (-1 for a change relayed from another item), its language, and when it happened (ms). */
interface Change { readonly pos: number; readonly language: string; readonly at: number }
interface CascadeState { readonly changes: readonly Change[]; readonly onRunBelow: ((cellKey: string) => void) | undefined }

const key = new PluginKey<CascadeState>("qmdCascadeStale");
/** Fired on the editor's element when the changes change, so the outputs look again. */
const CASCADE_EVENT = "qmd-cascade-change";
const MAX_CHANGES = 200;
const MAYBE_STALE_TEXT = "May be out of date: a cell above changed since this ran";

const languageOf = (node: ProseNode): string => fenceCellLanguage(node.attrs.lang as string | null) ?? (node.attrs.lang as string | null) ?? "";

/** The cells and outputs of `after` that differ from `before` inside the span that changed, each as a change at `at`; an output counts for the cell it follows. */
function docChanges(tr: Transaction, before: ProseNode, after: ProseNode, at: number): Change[] {
  const start = before.content.findDiffStart(after.content);
  if (start === null) return [];
  const hi = Math.max(start, before.content.findDiffEnd(after.content)!.b);
  const inverse = tr.mapping.invert();
  const found: Change[] = [];
  let language = "";
  after.nodesBetween(0, hi, (node, pos) => {
    const name = node.type.name;
    if (name !== "code_cell" && name !== "output") return !node.isTextblock;
    if (name === "code_cell") language = languageOf(node);
    if (pos >= hi || pos + node.nodeSize <= start) return false;
    const old = before.nodeAt(inverse.map(pos));
    const same = old?.type === node.type && (name === "output"
      ? old.attrs.raw === node.attrs.raw
      : old.attrs.code === node.attrs.code && old.attrs.options === node.attrs.options && old.attrs.lang === node.attrs.lang);
    if (!same) found.push({ pos, language, at });
    return false;
  });
  return found;
}

/** `added` joined to `changes`: a cell changed again replaces its earlier change; only the latest few are kept. */
function merge(changes: readonly Change[], added: readonly Change[]): readonly Change[] {
  const kept = changes.filter((change) => !added.some((next) => next.pos === change.pos && next.language === change.language));
  return [...kept, ...added].slice(-MAX_CHANGES);
}

/** The plugin: tracks the edited or rerun cells and, when they change, tells the outputs to look again. `onRunBelow` receives the item-local key of the cell whose Run below was pressed. */
export function cascadeStalePlugin(options: { onRunBelow?(cellKey: string): void }): Plugin {
  const initial: CascadeState = { changes: [], onRunBelow: options.onRunBelow };
  return new Plugin<CascadeState>({
    key,
    state: {
      init: () => initial,
      apply(tr, value, oldState, newState) {
        let changes = value.changes;
        if (tr.docChanged) {
          const mapped = changes.map((change) => (change.pos < 0 ? change : { ...change, pos: tr.mapping.map(change.pos, -1) }));
          if (mapped.some((change, i) => change.pos !== changes[i]!.pos)) changes = mapped;
          changes = merge(changes, docChanges(tr, oldState.doc, newState.doc, Date.now()));
        }
        const upstream = tr.getMeta(key) as { language: string; at: number } | undefined;
        if (upstream) changes = merge(changes, [{ pos: -1, language: upstream.language, at: upstream.at }]);
        return changes === value.changes ? value : { ...value, changes };
      },
    },
    view: () => ({
      update(view, previous) {
        if (key.getState(view.state) !== key.getState(previous)) view.dom.dispatchEvent(new CustomEvent(CASCADE_EVENT));
      },
    }),
  });
}

/** Records a change made in another item: the cells of `language` that ran before `at` (ms) become 'May be out of date'. Does nothing without the plugin. */
export function markUpstreamChange(view: EditorView, language: string, at: number): void {
  if (view.isDestroyed || !key.getState(view.state)) return;
  view.dispatch(view.state.tr.setMeta(key, { language: fenceCellLanguage(language) ?? language, at }));
}

/** The item-local key of the cell at `cellPos`: its label, else `cell-` and its ordinal. */
function cellKeyAt(doc: ProseNode, cellPos: number, labelOf: (options: string) => string): string {
  let ordinal = 0;
  let found = "";
  doc.descendants((node, pos) => {
    if (node.type.name !== "code_cell") return found === "" && !node.isTextblock;
    ordinal += 1;
    if (pos === cellPos) found = labelOf(node.attrs.options as string) || `cell-${ordinal}`;
    return false;
  });
  return found;
}

/** The time (ms) of the last run in this view, by run info; never stored. */
const runTimes = new WeakMap<CellRunInfo, number>();

/** Stamps a run made in this view now, so a cell run since a change is not marked. */
export function stampRun(info: CellRunInfo): void {
  runTimes.set(info, Date.now());
}

/** What an output's view finds out about itself on each look. */
interface Located { readonly cellPos: number | null; readonly ran: string | null; readonly run: CellRunInfo | undefined }

/** Whether a later change of the cell's language happened after the output ran. */
function isMaybeStale(state: EditorState, cellPos: number, ranAt: number): boolean {
  const cell = state.doc.nodeAt(cellPos);
  const cascade = key.getState(state);
  if (!cascade || !cell || !(ranAt > 0)) return false;
  const language = languageOf(cell);
  return cascade.changes.some((change) => change.language === language && change.pos < cellPos && ranAt < change.at);
}

/** The weaker caption of one output: shown while a cell above of the same language changed after this output ran, beside (never over) its own Out of date caption. */
export class MaybeStaleCaption {
  private caption: HTMLElement | null = null;
  private own = false;
  private readonly look = (): void => this.update();

  /** `labelOf` reads a cell's label from its options; it is passed in so this file does not import the output view. */
  constructor(private readonly view: EditorView, private readonly dom: HTMLElement, private readonly locate: () => Located, private readonly labelOf: (options: string) => string) {
    view.dom.addEventListener(CASCADE_EVENT, this.look);
  }

  /** Records whether the output is out of date on its own account, which keeps priority. */
  setOwn(own: boolean): void {
    this.own = own;
    this.update();
  }

  update(): void {
    if (this.view.isDestroyed) return;
    const { cellPos, ran, run } = this.locate();
    const ranAt = Math.max(Date.parse(ran ?? "") || 0, (run && runTimes.get(run)) || 0);
    const marked = !this.own && cellPos !== null && isMaybeStale(this.view.state, cellPos, ranAt);
    this.dom.classList.toggle("is-maybe-stale", marked);
    if (!marked) {
      this.caption?.remove();
      this.caption = null;
    } else if (!this.caption) {
      const onRunBelow = key.getState(this.view.state)?.onRunBelow;
      this.caption = renderElement("div", { class: "qmd-output-caption qmd-output-caption-maybe", role: "note" },
        renderElement("span", { class: "qmd-output-caption-icon", html: renderIcon("warning"), "aria-hidden": "true" }),
        renderElement("span", { class: "qmd-output-caption-text" }, MAYBE_STALE_TEXT));
      if (onRunBelow) {
        const button = renderElement("button", { class: "qmd-output-action qmd-output-run-below", type: "button" }, "Run below");
        button.addEventListener("click", () => {
          const at = this.locate().cellPos;
          if (at !== null) onRunBelow(cellKeyAt(this.view.state.doc, at, this.labelOf));
        });
        this.caption.append(button);
      }
      this.dom.prepend(this.caption);
    }
  }

  destroy(): void {
    this.view.dom.removeEventListener(CASCADE_EVENT, this.look);
  }
}
