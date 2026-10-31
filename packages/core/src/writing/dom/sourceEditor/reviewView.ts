/** Review mode's look (D5): tracked changes as marks and struck-through widgets, a tooltip to accept or reject one, a panel for all, and the mode dropdown. */
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, type Panel, showPanel, showTooltip, type Tooltip, WidgetType } from "@codemirror/view";
import { formatRelativeTime } from "../../../time/index.js";
import { renderElement } from "../../../ui/dom/index.js";
import { renderIcon, type IconName } from "../../../ui/icons/index.js";
import type { ReviewMode, ReviewTracking, TrackedChange } from "./review.js";
import type { SourceToolbarDropdown } from "./toolbar.js";

export interface ReviewView {
  extension: Extension;
  /** Switches the tracking's mode and what the view shows for it. */
  setMode(view: EditorView, mode: ReviewMode): void;
}

class DeletedText extends WidgetType {
  constructor(private readonly text: string) { super(); }
  eq(other: WidgetType): boolean { return other instanceof DeletedText && other.text === this.text; }
  toDOM(): HTMLElement {
    const del = document.createElement("del");
    del.className = "ls-review-delete";
    del.textContent = this.text;
    return del;
  }
  ignoreEvent(): boolean { return false; }
}

const insertMark = Decoration.mark({ class: "ls-review-insert" });

const reviewTheme = EditorView.baseTheme({
  ".ls-review-insert": { backgroundColor: "color-mix(in srgb, var(--ls-mark-accent) 22%, transparent)", textDecoration: "none" },
  ".ls-review-delete": { color: "var(--ls-error)", textDecoration: "line-through" },
  ".ls-review-tooltip": { display: "flex", flexDirection: "column", gap: "var(--ls-space-1)", padding: "var(--ls-space-1) var(--ls-space-2)" },
  ".ls-review-entry": { display: "flex", alignItems: "center", gap: "var(--ls-space-2)", fontSize: "var(--ls-text-sm)" },
  ".ls-review-author": { fontWeight: "bold" },
  ".ls-review-time": { color: "var(--ls-desc)" },
  ".ls-review-entry .ls-review-actions": { marginLeft: "auto", display: "flex", gap: "var(--ls-space-1)" },
  ".ls-review-action": {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "var(--ls-space-1)", height: "var(--ls-row-h)",
    padding: "0 var(--ls-space-2)", border: "none", borderRadius: "var(--ls-radius-sm)", background: "none", color: "var(--ls-fg)",
    fontSize: "var(--ls-text-sm)", cursor: "pointer",
  },
  ".ls-review-action svg": { width: "var(--ls-space-6)", height: "var(--ls-space-6)", flexShrink: "0" },
  ".ls-review-action:hover": { backgroundColor: "var(--ls-toolbar-hover)" },
  ".ls-review-action:focus-visible": { outline: "thin solid var(--ls-focus)" },
  ".ls-review-action:disabled": { color: "var(--ls-desc)", cursor: "default", backgroundColor: "transparent" },
  ".ls-review-panel": {
    display: "flex", alignItems: "center", gap: "var(--ls-space-2)", height: "calc(var(--ls-pane-footer-h) - 1px)",
    padding: "0 var(--ls-space-3)", boxSizing: "border-box", fontSize: "var(--ls-text-sm)",
  },
  ".ls-review-summary": { color: "var(--ls-desc)" },
  ".ls-review-panel .ls-review-actions": { marginLeft: "auto", display: "flex", gap: "var(--ls-space-1)" },
});

function actionButton(label: string, icon: IconName, run: () => void): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: "ls-review-action", title: label }) as HTMLButtonElement;
  button.innerHTML = renderIcon(icon);
  button.append(renderElement("span", {}, label));
  // The editor keeps its focus and selection on a click; Tab still reaches the button.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", run);
  return button;
}

/** The changes the cursor touches: an insert it sits in or at an edge of, a delete it sits on. */
function changesAt(changes: readonly TrackedChange[], state: EditorState): TrackedChange[] {
  const { head, empty } = state.selection.main;
  if (!empty) { return []; }
  return changes.filter((c) => (c.kind === "insert" ? c.from <= head && head <= c.to : c.from === head));
}

function buildMarks(tracking: ReviewTracking, state: EditorState): DecorationSet {
  const length = state.doc.length;
  const ranges = tracking.changes(state).flatMap((c) => {
    if (c.kind === "insert") { return c.to > c.from && c.from >= 0 && c.to <= length ? [insertMark.range(c.from, c.to)] : []; }
    return c.text && c.from >= 0 && c.from <= length ? [Decoration.widget({ widget: new DeletedText(c.text), side: -1 }).range(c.from)] : [];
  });
  return Decoration.set(ranges, true);
}

/** The tooltip's row of one change: who suggested it and when, with its accept and reject buttons. */
function tooltipEntry(tracking: ReviewTracking, change: TrackedChange, view: EditorView, now: number): HTMLElement {
  const entry = renderElement("div", { class: "ls-review-entry" });
  entry.append(
    renderElement("span", { class: "ls-review-author" }, change.author),
    renderElement("span", { class: "ls-review-time", title: change.created }, formatRelativeTime(change.created, now)),
  );
  const actions = renderElement("div", { class: "ls-review-actions" });
  actions.append(
    actionButton("Accept", "check", () => tracking.accept(view, [change.id])),
    actionButton("Reject", "x", () => tracking.reject(view, [change.id])),
  );
  entry.append(actions);
  return entry;
}

function tooltipFor(tracking: ReviewTracking, state: EditorState, now: () => number): Tooltip | null {
  const at = changesAt(tracking.changes(state), state);
  if (at.length === 0) { return null; }
  return {
    pos: state.selection.main.head,
    above: true,
    create(view) {
      const dom = renderElement("div", { class: "ls-review-tooltip", role: "group", "aria-label": "Suggestion" });
      for (const change of at) { dom.append(tooltipEntry(tracking, change, view, now())); }
      return { dom };
    },
  };
}

/** The panel with the suggestion count and the accept-all and reject-all buttons. */
function createPanel(tracking: ReviewTracking, modeField: StateField<ReviewMode>, view: EditorView): Panel {
  const dom = renderElement("div", { class: "ls-review-panel", role: "region", "aria-label": "Suggestions" });
  const summary = renderElement("span", { class: "ls-review-summary" });
  const ids = (): string[] => tracking.changes(view.state).map((c) => c.id);
  const acceptAll = actionButton("Accept all", "check", () => tracking.accept(view, ids()));
  const rejectAll = actionButton("Reject all", "x", () => tracking.reject(view, ids()));
  const actions = renderElement("div", { class: "ls-review-actions" });
  actions.append(acceptAll, rejectAll);
  dom.append(summary, actions);
  const refresh = (state: EditorState): void => {
    const count = tracking.changes(state).length;
    const reviewing = state.field(modeField) === "reviewing";
    summary.textContent = count === 0 ? "Reviewing: edits become suggestions" : `${count} ${count === 1 ? "suggestion" : "suggestions"}${reviewing ? " · Reviewing" : ""}`;
    acceptAll.disabled = count === 0;
    rejectAll.disabled = count === 0;
  };
  refresh(view.state);
  return { dom, update: (update) => refresh(update.state) };
}

export function createReviewView(tracking: ReviewTracking, options: { now?(): number } = {}): ReviewView {
  const now = options.now ?? ((): number => Date.now());
  const setViewMode = StateEffect.define<ReviewMode>();

  const modeField = StateField.define<ReviewMode>({
    create: () => "editing",
    update(value, tr) {
      for (const effect of tr.effects) { if (effect.is(setViewMode)) { return effect.value; } }
      return value;
    },
  });

  // Fields read the tracking's records through tr.state, so they follow both edits and accept/reject effects.
  const marksField = StateField.define<DecorationSet>({
    create: (state) => buildMarks(tracking, state),
    update(value, tr) {
      return tracking.changes(tr.state) === tracking.changes(tr.startState) ? value.map(tr.changes) : buildMarks(tracking, tr.state);
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  const tooltipField = StateField.define<Tooltip | null>({
    create: (state) => tooltipFor(tracking, state, now),
    update(value, tr) {
      const same = tracking.changes(tr.state) === tracking.changes(tr.startState) && !tr.selection && !tr.docChanged;
      return same ? value : tooltipFor(tracking, tr.state, now);
    },
    provide: (field) => showTooltip.from(field),
  });

  const panel = (view: EditorView): Panel => createPanel(tracking, modeField, view);
  const panelShown = (state: EditorState): boolean => state.field(modeField) === "reviewing" || tracking.changes(state).length > 0;
  const panelField = StateField.define<boolean>({
    create: panelShown,
    update: (_value, tr) => panelShown(tr.state),
    provide: (field) => showPanel.from(field, (shown) => (shown ? panel : null)),
  });

  return {
    extension: [modeField, marksField, tooltipField, panelField, reviewTheme],
    setMode(view, mode) {
      tracking.setMode(view, mode);
      view.dispatch({ effects: setViewMode.of(mode) });
    },
  };
}

/** The toolbar's mode dropdown: Editing or Reviewing, with the current one checked. */
export function reviewModeDropdown(current: () => ReviewMode, pick: (mode: ReviewMode) => void): SourceToolbarDropdown {
  return {
    label: "Review mode",
    glyph: "edit",
    options: [
      { value: "editing", label: "Editing", hint: "Edit content directly" },
      { value: "reviewing", label: "Reviewing", hint: "Edits become suggestions" },
    ],
    current,
    pick: (value) => pick(value === "reviewing" ? "reviewing" : "editing"),
  };
}
