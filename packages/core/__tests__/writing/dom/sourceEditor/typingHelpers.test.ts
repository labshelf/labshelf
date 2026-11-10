/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Pins the editor side of the typing helpers: typed input and keys go through the helpers, closers are tracked for overtype,
// the switch reconfigures live, and the ⋯ menu's Customize Shortcuts… saves each flip.
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { DEFAULT_TYPING_HELPERS } from "../../../../src/writing/typing/index";
import { createTypingSwitch } from "../../../../src/writing/dom/sourceEditor/typingHelpers";
import { openTypingHelpersDialog } from "../../../../src/writing/dom/sourceEditor/typingHelpersDialog";
import { renderSourceMoreEntries } from "../../../../src/writing/dom/sourceEditor/toolbar";

function mount(doc: string, cursor: number, language: "latex" | "typst" = "latex", readOnly = false) {
  let view: EditorView | undefined;
  const typing = createTypingSwitch(language, DEFAULT_TYPING_HELPERS, () => view);
  view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [typing.extension, EditorState.readOnly.of(readOnly), EditorState.allowMultipleSelections.of(true)] }) });
  return { view, typing };
}

/** Types as the DOM would: the input handlers first, the plain insert when none takes it. */
function typeText(view: EditorView, text: string): void {
  for (const char of text) {
    const { from, to } = view.state.selection.main;
    const handled = view.state.facet(EditorView.inputHandler).some((handler) => handler(view, from, to, char, () => view.state.update({ changes: { from, to, insert: char } })));
    if (!handled) view.dispatch({ changes: { from, to, insert: char }, selection: { anchor: from + 1 }, userEvent: "input.type" });
  }
}

const press = (view: EditorView, key: string): boolean => runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor");

const marked = (view: EditorView): string => {
  const doc = view.state.doc.toString();
  const head = view.state.selection.main.head;
  return `${doc.slice(0, head)}‸${doc.slice(head)}`;
};

afterEach(() => { document.body.innerHTML = ""; });

describe("typing helpers in the editor", () => {
  it("pairs a bracket and steps over its tracked closer", () => {
    const { view } = mount("a ", 2);
    typeText(view, "(x)");
    expect(marked(view)).toBe("a (x)‸");
  });

  it("does not step over a closer it did not insert", () => {
    const { view } = mount("a ()", 3);
    typeText(view, ")");
    expect(marked(view)).toBe("a ()‸)");
  });

  it("deletes an empty pair on Backspace and splits display math on Enter", () => {
    const { view } = mount("\\[\\]", 2);
    expect(press(view, "Enter")).toBe(true);
    expect(view.state.doc.toString()).toBe("\\[\n  \n\\]");
    const pair = mount("()", 1).view;
    expect(press(pair, "Backspace")).toBe(true);
    expect(pair.state.doc.toString()).toBe("");
  });

  it("wraps each of several selections", () => {
    const { view } = mount("a b", 0);
    view.dispatch({ selection: EditorSelection.create([EditorSelection.range(0, 1), EditorSelection.range(2, 3)]) });
    typeText(view, "(");
    expect(view.state.doc.toString()).toBe("(a) (b)");
  });

  it("switches live: off, the plain character is typed", () => {
    const { view, typing } = mount("a ", 2);
    typing.control.set({ ...DEFAULT_TYPING_HELPERS, brackets: false });
    expect(typing.control.get().brackets).toBe(false);
    typeText(view, "(");
    expect(marked(view)).toBe("a (‸");
  });

  it("leaves a read-only editor alone", () => {
    const { view } = mount("a ", 2, "latex", true);
    expect(press(view, "Backspace")).toBe(false);
  });
});

describe("Customize Shortcuts", () => {
  it("is in the ⋯ menu only with saveTyping, and each flip sets and saves all the helpers", () => {
    const { view, typing } = mount("x", 0, "typst");
    const saved: boolean[] = [];
    const editor = {
      spelling: undefined, showShortcuts: jest.fn(), typing: typing.control,
      showTypingHelpers: (onChange: Parameters<typeof openTypingHelpersDialog>[0]["onChange"]) => openTypingHelpersDialog({ language: "typst", helpers: typing.control.get(), onChange, view }),
    };
    expect(renderSourceMoreEntries(editor, () => undefined).map((entry) => entry !== "separator" && entry.label)).not.toContain("Customize Shortcuts…");
    const entries = renderSourceMoreEntries(editor, () => undefined, (next) => saved.push(next.quotes));
    const entry = entries.find((e) => e !== "separator" && e.label === "Customize Shortcuts…");
    expect(entry).toBeDefined();
    if (entry && entry !== "separator") entry.onSelect?.();
    const labels = [...document.querySelectorAll(".ls-typing-row")].map((row) => row.textContent ?? "");
    // Typst lists no LaTeX-only helper.
    expect(labels.some((label) => label.includes("\\left"))).toBe(false);
    const quotes = document.querySelector<HTMLInputElement>('input[aria-label="Close quotes"]')!;
    quotes.click();
    expect(saved).toEqual([false]);
    expect(typing.control.get().quotes).toBe(false);
  });
});
