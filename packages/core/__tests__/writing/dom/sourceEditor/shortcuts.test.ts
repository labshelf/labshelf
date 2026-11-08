/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Tests the source editor's own shortcuts: duplicate, case, inline math, wrap in an environment, track changes, the key
// labels per platform and the Keyboard Shortcuts dialog.
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { createShortcuts, formatShortcut, openShortcutsDialog, SOURCE_SHORTCUTS } from "../../../../src/writing/dom/sourceEditor/shortcuts";

function mount(doc: string, selection: EditorSelection, toggleReview?: () => void): EditorView {
  const extensions = [EditorState.allowMultipleSelections.of(true), createShortcuts("latex", toggleReview ? { toggleReview } : {})];
  return new EditorView({ parent: document.body, state: EditorState.create({ doc, selection, extensions }) });
}

/** Presses Ctrl and `key` on the editor; with Shift the key comes as a browser sends it, upper case, its base in keyCode. */
function press(view: EditorView, key: string, mods: { shift?: boolean } = {}): boolean {
  const shift = mods.shift ?? false;
  const event = new KeyboardEvent("keydown", { key: shift ? key.toUpperCase() : key, ctrlKey: true, shiftKey: shift });
  Object.defineProperty(event, "keyCode", { value: key.toUpperCase().charCodeAt(0) });
  return runScopeHandlers(view, event, "editor");
}

describe("createShortcuts", () => {
  it("duplicates the selection, or the line of an empty one", () => {
    const view = mount("abc\nx", EditorSelection.create([EditorSelection.range(0, 2)]));
    expect(press(view, "d", { shift: true })).toBe(true);
    expect(view.state.doc.toString()).toBe("ababc\nx");
    view.dispatch({ selection: { anchor: 6 } });
    press(view, "d", { shift: true });
    expect(view.state.doc.toString()).toBe("ababc\nx\nx");
    view.destroy();
  });

  it("upper cases the selection and lower cases the word at the cursor", () => {
    const view = mount("hello World", EditorSelection.create([EditorSelection.range(0, 5)]));
    press(view, "u");
    expect(view.state.doc.toString()).toBe("HELLO World");
    view.dispatch({ selection: { anchor: 8 } });
    press(view, "u", { shift: true });
    expect(view.state.doc.toString()).toBe("HELLO world");
    view.destroy();
  });

  it("wraps the selection in inline math", () => {
    const view = mount("x^2", EditorSelection.create([EditorSelection.range(0, 3)]));
    press(view, "m", { shift: true });
    expect(view.state.doc.toString()).toBe("$x^2$");
    view.destroy();
  });

  it("wraps the selected lines in an environment with a cursor in each name", () => {
    const view = mount("  a\n  b", EditorSelection.create([EditorSelection.range(2, 7)]));
    press(view, "e", { shift: true });
    expect(view.state.doc.toString()).toBe("  \\begin{}\n  a\n  b\n  \\end{}");
    view.dispatch(view.state.replaceSelection("itemize"));
    expect(view.state.doc.toString()).toBe("  \\begin{itemize}\n  a\n  b\n  \\end{itemize}");
    view.destroy();
  });

  it("switches track changes only where the editor has a review", () => {
    const toggle = jest.fn();
    const view = mount("a", EditorSelection.create([EditorSelection.cursor(0)]), toggle);
    press(view, "a", { shift: true });
    expect(toggle).toHaveBeenCalledTimes(1);
    view.destroy();
    const plain = mount("a", EditorSelection.create([EditorSelection.cursor(0)]));
    expect(press(plain, "a", { shift: true })).toBe(false);
    plain.destroy();
  });
});

describe("formatShortcut", () => {
  it("writes the keys per platform", () => {
    const duplicate = SOURCE_SHORTCUTS.find((s) => s.keys === "Mod-Shift-d")!;
    expect(formatShortcut(duplicate, false)).toBe("Ctrl+Shift+D");
    expect(formatShortcut(duplicate, true)).toBe("⌘⇧D");
    expect(formatShortcut({ keys: "Mod-Shift-\\", label: "", group: "Navigation" }, false)).toBe("Ctrl+Shift+\\");
  });
});

describe("openShortcutsDialog", () => {
  it("lists every shortcut and closes on Close", () => {
    openShortcutsDialog();
    expect(document.querySelectorAll(".ls-shortcuts-row")).toHaveLength(SOURCE_SHORTCUTS.length);
    document.querySelector<HTMLButtonElement>(".ls-shortcuts-dialog .ls-dialog-actions button")!.click();
    expect(document.querySelector(".ls-shortcuts-dialog")).toBeNull();
  });
});
