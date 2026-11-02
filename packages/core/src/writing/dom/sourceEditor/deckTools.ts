// The editor toolbar of a LaTeX or Typst talk or poster. A talk gets Present, Insert slide (by layout), Go to slide, the slide actions
// on the slide at the cursor (move, duplicate, delete, speaker note) and its aspect ratio. A poster gets Real size, Insert block (by layout),
// Go to block and its print size. Every edit goes through the editor, so it is one undo step and follows review mode.
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  BLOCK_LAYOUTS, SLIDE_LAYOUTS, deleteSourceSlide, describeSourceDeck, duplicateSourceSlide, findItemAt, insertSourceBlock, insertSourceNote, insertSourceSlide,
  listSourceDeckShapes, moveSourceSlide, readSourceDeckOutline, readSourceDeckShape, setSourceDeckShape, type DeckKind, type SourceDeckChange, type SourceDeckFormat,
} from "../../../decks/index.js";
import type { MenuEntry } from "../../../ui/dom/index.js";
import { reviewEdit } from "./review.js";
import type { SourceToolbarItem } from "./toolbar.js";

/** What the deck tools need of the editor: its text and cursor, applying a change as one edit, and scrolling to an offset. */
export interface SourceDeckEditing {
  text(): string;
  cursor(): number;
  apply(change: SourceDeckChange): void;
  reveal(offset: number): void;
}

/** Applies a whole-text change as the smallest splice (the common start and end kept), so undo, review and peers see only what changed. */
export function createDeckEditing(view: EditorView): SourceDeckEditing {
  return {
    text: () => view.state.doc.toString(),
    cursor: () => view.state.selection.main.head,
    apply: ({ text, cursor }) => {
      const old = view.state.doc.toString();
      let start = 0;
      while (start < old.length && start < text.length && old[start] === text[start]) start++;
      let end = 0;
      while (end < old.length - start && end < text.length - start && old[old.length - 1 - end] === text[text.length - 1 - end]) end++;
      view.dispatch({
        changes: { from: start, to: old.length - end, insert: text.slice(start, text.length - end) },
        selection: EditorSelection.cursor(Math.min(cursor, text.length)),
        scrollIntoView: true, userEvent: "input", annotations: reviewEdit.of(true),
      });
      view.focus();
    },
    reveal: (offset) => {
      view.dispatch({ selection: EditorSelection.cursor(offset), scrollIntoView: true });
      view.focus();
    },
  };
}

/** What the host opens for a talk or poster. */
export interface DeckToolHooks { present(): void; posterPreview(): void }

const formatOf = (path: string): SourceDeckFormat => (path.endsWith(".typ") ? "typst" : "latex");

/** The kind of talk or poster the file is, or undefined for any other document. */
export function readDeckKindOf(path: string, text: string): DeckKind | undefined {
  if (!/\.(tex|typ)$/.test(path)) return undefined;
  return describeSourceDeck(formatOf(path), path.replace(/^.*?(?=(talks|posters)\/[^/]+\/main\.(tex|typ)$)/, ""), text)?.kind;
}

function goTo(editing: SourceDeckEditing, format: SourceDeckFormat, kind: DeckKind, noun: string): SourceToolbarItem {
  return {
    label: `Go to ${noun}`, glyph: "list",
    menu: (): MenuEntry[] => {
      const text = editing.text();
      const items = readSourceDeckOutline(format, kind, text);
      const at = findItemAt(items, editing.cursor());
      if (items.length === 0) return [{ label: `No ${noun}s yet`, disabled: true, onSelect: () => undefined }];
      return items.map((item, index) => ({ label: `${index + 1}. ${item.title}`, radio: true, checked: index === at, onSelect: () => editing.reveal(item.start) }));
    },
  };
}

function sizeDropdown(editing: SourceDeckEditing, format: SourceDeckFormat, kind: DeckKind): SourceToolbarItem {
  const choices = listSourceDeckShapes(kind, format);
  return {
    label: kind === "talk" ? "Aspect ratio" : "Poster size", glyph: "grid",
    options: choices.map((choice) => ({ value: choice.label, label: choice.label, ...(choice.description ? { hint: choice.description } : {}) })),
    current: () => readSourceDeckShape(format, kind, editing.text()) ?? "",
    pick: (value) => {
      const choice = choices.find((c) => c.label === value);
      const text = editing.text();
      const next = choice ? setSourceDeckShape(format, text, choice.shape) : null;
      if (next !== null && next !== text) editing.apply({ text: next, cursor: Math.min(editing.cursor(), next.length) });
    },
  };
}

function slideActions(editing: SourceDeckEditing, format: SourceDeckFormat): SourceToolbarItem {
  const onSlide = (edit: (text: string, slides: ReturnType<typeof readSourceDeckOutline>, index: number) => string | null, place: (slides: ReturnType<typeof readSourceDeckOutline>, index: number) => number) => (): void => {
    const text = editing.text();
    const slides = readSourceDeckOutline(format, "talk", text);
    const index = findItemAt(slides, editing.cursor());
    const next = index < 0 ? null : edit(text, slides, index);
    if (next === null || next === text) return;
    editing.apply({ text: next, cursor: place(readSourceDeckOutline(format, "talk", next), index) });
  };
  const startOf = (offset: number) => (slides: ReturnType<typeof readSourceDeckOutline>, index: number): number => slides[Math.max(0, Math.min(index + offset, slides.length - 1))]?.start ?? 0;
  return {
    label: "Slide at the cursor", glyph: "layers",
    menu: (): MenuEntry[] => [
      { label: "Add speaker note", onSelect: () => { const change = insertSourceNote(format, editing.text(), editing.cursor()); if (change) editing.apply(change); } },
      "separator",
      { label: "Move slide up", onSelect: onSlide((text, slides, index) => moveSourceSlide(text, slides, index, -1), startOf(-1)) },
      { label: "Move slide down", onSelect: onSlide((text, slides, index) => moveSourceSlide(text, slides, index, 1), startOf(1)) },
      { label: "Duplicate slide", onSelect: onSlide(duplicateSourceSlide, startOf(1)) },
      { label: "Delete slide", danger: true, onSelect: onSlide(deleteSourceSlide, startOf(0)) },
    ],
  };
}

/** The toolbar groups of a talk or poster source, first in the bar; none for any other document. */
export function createDeckToolbarGroups(path: string, editing: SourceDeckEditing | undefined, hooks: DeckToolHooks): SourceToolbarItem[][] {
  if (!editing) return [];
  const kind = readDeckKindOf(path, editing.text());
  if (!kind) return [];
  const format = formatOf(path);
  if (kind === "talk") {
    return [
      [{ label: "Present", glyph: "play", primary: true, run: hooks.present }],
      [
        { label: "Insert slide", glyph: "plus", caption: "Slide", menu: () => SLIDE_LAYOUTS.map((layout) => ({ label: layout.label, onSelect: () => editing.apply(insertSourceSlide(format, editing.text(), editing.cursor(), layout.id)) })) },
        goTo(editing, format, "talk", "slide"),
        slideActions(editing, format),
      ],
      [sizeDropdown(editing, format, "talk")],
    ];
  }
  return [
    [{ label: "Real size", glyph: "eye", primary: true, run: hooks.posterPreview }],
    [
      { label: "Insert block", glyph: "plus", caption: "Block", menu: () => BLOCK_LAYOUTS.map((layout) => ({ label: layout.label, onSelect: () => editing.apply(insertSourceBlock(format, editing.text(), editing.cursor(), layout.id)) })) },
      goTo(editing, format, "poster", "block"),
    ],
    [sizeDropdown(editing, format, "poster")],
  ];
}
