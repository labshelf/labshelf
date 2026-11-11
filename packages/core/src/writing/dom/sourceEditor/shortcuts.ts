// The source editor's keyboard shortcuts: the list the Keyboard Shortcuts dialog shows, Overleaf's keys where CodeMirror's
// defaults differ, and a few of LabShelf's own (wrap in an environment, inline math).
import { startCompletion } from "@codemirror/autocomplete";
import { copyLineDown } from "@codemirror/commands";
import { foldAll, toggleFold, unfoldAll } from "@codemirror/language";
import { gotoLine } from "@codemirror/search";
import { EditorSelection, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap, type Command } from "@codemirror/view";
import { mountOverlay, renderElement } from "../../../ui/dom/index.js";
import type { SourceLanguage } from "./formatting.js";

type ShortcutGroup = "Editing" | "Formatting" | "Selection" | "Navigation" | "Search" | "Folding" | "Review";

export interface Shortcut {
  /** CodeMirror's key notation: Mod is Cmd on a Mac and Ctrl elsewhere. */
  keys: string;
  /** The keys on a Mac, where they are not `keys` with Mod as Cmd. */
  mac?: string;
  label: string;
  group: ShortcutGroup;
  /** LabShelf's own: Overleaf has no such key. */
  extra?: boolean;
}

/** Every shortcut of the source editor, CodeMirror's defaults included, in the dialog's order. */
export const SOURCE_SHORTCUTS: readonly Shortcut[] = [
  { keys: "Mod-z", label: "Undo", group: "Editing" },
  { keys: "Mod-y", mac: "Mod-Shift-z", label: "Redo", group: "Editing" },
  { keys: "Mod-s", label: "Save", group: "Editing" },
  { keys: "Mod-/", label: "Comment or uncomment the lines", group: "Editing" },
  { keys: "Mod-Shift-k", label: "Delete the line", group: "Editing" },
  { keys: "Mod-Shift-d", label: "Duplicate the selection, or the line", group: "Editing" },
  { keys: "Alt-ArrowUp", label: "Move the lines up (Down: down)", group: "Editing" },
  { keys: "Alt-Shift-ArrowUp", label: "Copy the lines up (Down: down)", group: "Editing" },
  { keys: "Mod-]", label: "Indent more (Mod-[: less)", group: "Editing" },
  { keys: "Mod-Enter", label: "Insert a blank line below", group: "Editing" },
  { keys: "Ctrl-Space", label: "Open the completions (also Alt-Space)", group: "Editing" },
  { keys: "Mod-b", label: "Bold", group: "Formatting" },
  { keys: "Mod-i", label: "Italic", group: "Formatting" },
  { keys: "Mod-u", label: "Upper case", group: "Formatting" },
  { keys: "Mod-Shift-u", label: "Lower case", group: "Formatting" },
  { keys: "Mod-Shift-m", label: "Wrap in inline math", group: "Formatting", extra: true },
  { keys: "Mod-Shift-e", label: "Wrap in an environment (LaTeX)", group: "Formatting", extra: true },
  { keys: "Mod-a", label: "Select all", group: "Selection" },
  { keys: "Mod-d", label: "Select the next occurrence", group: "Selection" },
  { keys: "Mod-Alt-ArrowUp", label: "Add a cursor above (Down: below)", group: "Selection" },
  { keys: "Mod-Click", label: "Add a cursor", group: "Selection" },
  { keys: "Mod-.", label: "Open the selection popup", group: "Selection", extra: true },
  { keys: "Mod-Home", label: "Go to the start of the file (End: the end)", group: "Navigation" },
  { keys: "Mod-Shift-l", label: "Go to a line", group: "Navigation" },
  { keys: "Mod-Shift-\\", label: "Go to the matching bracket", group: "Navigation", extra: true },
  { keys: "Mod-f", label: "Find and replace", group: "Search" },
  { keys: "Mod-g", label: "Find next (Shift: previous)", group: "Search" },
  { keys: "F2", label: "Fold or unfold the section at the cursor", group: "Folding" },
  { keys: "Alt-Shift-1", label: "Fold all", group: "Folding" },
  { keys: "Alt-Shift-0", label: "Unfold all", group: "Folding" },
  { keys: "Mod-Shift-a", label: "Turn track changes on or off", group: "Review" },
  { keys: "Mod-Shift-c", label: "Comment on the selection (also Mod-Alt-m)", group: "Review" },
  { keys: "Mod-Shift-/", label: "Show these shortcuts", group: "Review", extra: true },
];

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const MAC_KEYS: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧", ArrowUp: "↑", ArrowDown: "↓", Enter: "↩", Space: "Space", Home: "Home", Click: "Click" };
const PC_KEYS: Record<string, string> = { Mod: "Ctrl", ArrowUp: "↑", ArrowDown: "↓" };

/** The keys as the platform writes them: ⌘⇧D on a Mac, Ctrl+Shift+D elsewhere. */
export function formatShortcut(shortcut: Shortcut, mac = isMac): string {
  const keys = (mac ? shortcut.mac ?? shortcut.keys : shortcut.keys).split(/-(?!$)/);
  const names = keys.map((key) => (mac ? MAC_KEYS : PC_KEYS)[key] ?? (key.length === 1 ? key.toUpperCase() : key));
  return mac ? names.join("") : names.join("+");
}

/** Each selection's copy after it; an empty one copies its line below. */
const duplicateSelection: Command = (view) => {
  if (view.state.readOnly) return false;
  if (view.state.selection.ranges.every((range) => range.empty)) return copyLineDown(view);
  view.dispatch(view.state.changeByRange((range) => {
    const text = view.state.sliceDoc(range.from, range.to);
    return { changes: { from: range.to, insert: text }, range: EditorSelection.range(range.to, range.to + text.length) };
  }), { scrollIntoView: true, userEvent: "input.copyline" });
  return true;
};

/** Upper or lower cases each selection, or the word at an empty one. */
const changeCase = (upper: boolean): Command => (view) => {
  if (view.state.readOnly) return false;
  view.dispatch(view.state.changeByRange((selected) => {
    const range = selected.empty ? view.state.wordAt(selected.head) ?? selected : selected;
    const text = view.state.sliceDoc(range.from, range.to);
    return { changes: { from: range.from, to: range.to, insert: upper ? text.toUpperCase() : text.toLowerCase() }, range: selected };
  }), { userEvent: "input" });
  return true;
};

/** Puts each selection between `open` and `close`; the cursor of an empty one goes between them. */
const wrapIn = (open: string, close: string): Command => (view) => {
  if (view.state.readOnly) return false;
  view.dispatch(view.state.changeByRange((range) => ({
    changes: [{ from: range.from, insert: open }, { from: range.to, insert: close }],
    range: EditorSelection.range(range.from + open.length, range.to + open.length),
  })), { userEvent: "input" });
  return true;
};

/** `\begin{}` before the selected lines and `\end{}` after them, with a cursor in each name so both are typed at once. */
export const wrapInEnvironment: Command = (view) => {
  if (view.state.readOnly) return false;
  const { state } = view;
  const range = state.selection.main;
  const first = state.doc.lineAt(range.from);
  const last = state.doc.lineAt(range.to);
  const indent = /^\s*/.exec(first.text)![0];
  const begin = `${indent}\\begin{}\n`;
  const end = `\n${indent}\\end{}`;
  const beginName = first.from + indent.length + "\\begin{".length;
  const endName = last.to + begin.length + end.length - 1;
  view.dispatch({
    changes: [{ from: first.from, insert: begin }, { from: last.to, insert: end }],
    selection: EditorSelection.create([EditorSelection.cursor(beginName), EditorSelection.cursor(endName)], 0),
    scrollIntoView: true, userEvent: "input",
  });
  return true;
};

export interface ShortcutHooks {
  /** Switches track changes; absent where the editor has no review. */
  toggleReview?(): void;
}

let dialogOpen = false;

/** The Keyboard Shortcuts dialog: the shortcuts by group, LabShelf's own marked; Close or Escape gives the focus back to the editor. */
export function openShortcutsDialog(view?: EditorView): void {
  if (dialogOpen) return;
  dialogOpen = true;
  const groups = [...new Set(SOURCE_SHORTCUTS.map((s) => s.group))];
  const heading = renderElement("div", { class: "ls-dialog-title", id: "ls-shortcuts-title", text: "Keyboard Shortcuts" });
  const close = renderElement("button", { type: "button", class: "ls-btn", text: "Close" });
  const sections = groups.map((group) => renderElement("section", { class: "ls-shortcuts-group" },
    renderElement("h3", { text: group }),
    ...SOURCE_SHORTCUTS.filter((s) => s.group === group).map((s) => renderElement("div", { class: "ls-shortcuts-row" },
      renderElement("span", { text: s.label }, ...(s.extra ? [renderElement("span", { class: "ls-shortcuts-extra", text: "LabShelf" })] : [])),
      renderElement("kbd", { text: formatShortcut(s) })))));
  const dialog = renderElement("div", { class: "ls-dialog ls-shortcuts-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": heading.id },
    renderElement("div", { class: "ls-dialog-head" }, heading),
    renderElement("div", { class: "ls-shortcuts" }, ...sections),
    renderElement("div", { class: "ls-dialog-actions" }, close));
  const dismiss = (): void => { dialogOpen = false; overlay.close(); view?.focus(); };
  const overlay = mountOverlay(dialog, dismiss);
  close.addEventListener("click", dismiss);
  close.focus();
}

/**
 * The keys on Option (Alt) with Shift or Space, read from the key's position: on a Mac Option changes the character
 * (Option-Shift-1 types ⁄), and CodeMirror then matches no binding.
 */
function positionalKeys(hooks: { foldAll: Command; unfoldAll: Command }): Extension {
  return EditorView.domEventHandlers({
    keydown(event, view) {
      if (event.ctrlKey || event.metaKey) {
        const showList = event.shiftKey && !event.altKey && event.code === "Slash";
        if (showList) { event.preventDefault(); openShortcutsDialog(view); }
        return showList;
      }
      if (!event.altKey) return false;
      const run = event.shiftKey ? { Digit1: hooks.foldAll, Digit0: hooks.unfoldAll }[event.code] : event.code === "Space" ? startCompletion : undefined;
      if (!run) return false;
      event.preventDefault();
      run(view);
      return true;
    },
  });
}

/** The shortcuts CodeMirror's default keymaps lack, ahead of them where a key means something else there (Mod-u, Mod-Shift-l). */
export function createShortcuts(language: SourceLanguage, hooks: ShortcutHooks = {}): Extension {
  return Prec.high([
    keymap.of([
      { key: "Mod-Shift-d", preventDefault: true, run: duplicateSelection },
      { key: "Mod-u", preventDefault: true, run: changeCase(true) },
      { key: "Mod-Shift-u", preventDefault: true, run: changeCase(false) },
      { key: "Mod-Shift-l", preventDefault: true, run: gotoLine },
      { key: "F2", preventDefault: true, run: toggleFold },
      { key: "Mod-Shift-m", preventDefault: true, run: wrapIn("$", "$") },
      ...(language === "latex" ? [{ key: "Mod-Shift-e", preventDefault: true, run: wrapInEnvironment }] : []),
      ...(hooks.toggleReview ? [{ key: "Mod-Shift-a", preventDefault: true, run: (): boolean => { hooks.toggleReview!(); return true; } }] : []),
    ]),
    positionalKeys({ foldAll, unfoldAll }),
  ]);
}
