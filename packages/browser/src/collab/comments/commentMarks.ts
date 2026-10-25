// Marks the text and the gutter lines that unresolved comment threads are anchored to, following unsaved edits.
import { RangeSet, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, gutter, GutterMarker } from "@codemirror/view";
import { icon, type TextRange } from "@labshelf/core";

export interface CommentMarks {
  extension: Extension;
  /** Replaces the marked ranges, given in document offsets. */
  setRanges(view: EditorView, ranges: readonly TextRange[]): void;
}

const replaceRanges = StateEffect.define<readonly TextRange[]>();

// INVARIANT: ranges are kept in document offsets; an edit that deletes a range leaves it empty and it is not drawn.
const rangesField = StateField.define<readonly TextRange[]>({
  create: () => [],
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(replaceRanges)) return effect.value;
    if (!transaction.docChanged) return value;
    return value.map((range) => ({ start: transaction.changes.mapPos(range.start, 1), end: transaction.changes.mapPos(range.end, -1) }));
  },
});

class CommentMarker extends GutterMarker {
  constructor(private readonly open: () => void) { super(); }
  eq(): boolean { return true; }
  toDOM(): HTMLElement {
    const button = document.createElement("button");
    button.className = "ls-comment-marker";
    button.type = "button";
    button.title = "Open comments";
    button.setAttribute("aria-label", "Open comments");
    button.innerHTML = icon("message");
    button.addEventListener("click", this.open);
    return button;
  }
}

const rangeMark = Decoration.mark({ class: "ls-comment-range" });

export function commentMarks(open: () => void): CommentMarks {
  const marker = new CommentMarker(open);
  const visible = (state: EditorView["state"]): TextRange[] =>
    state.field(rangesField).filter((range) => range.end > range.start && range.start >= 0 && range.end <= state.doc.length);
  const decorations = EditorView.decorations.compute([rangesField], (state) =>
    Decoration.set(visible(state).map((range) => rangeMark.range(range.start, range.end)), true));
  const markerGutter = gutter({
    class: "ls-comment-gutter",
    markers: (view) => RangeSet.of(visible(view.state).map((range) => marker.range(view.state.doc.lineAt(range.start).from)), true),
  });
  return {
    extension: [rangesField, decorations, markerGutter],
    setRanges: (view, ranges) => view.dispatch({ effects: replaceRanges.of(ranges) }),
  };
}
