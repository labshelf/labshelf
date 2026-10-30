/** @jest-environment jsdom */
/**
 * Tests the writing behaviour of the rich note editor: Markdown input rules while typing, Python fence shortcuts,
 * Backspace on a heading, and opening a new node's source editor.
 */
import { EditorState, TextSelection, type Plugin } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { Node as PmNode } from "prosemirror-model";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { docToBody } from "../../../src/qmd/editor";
import { codeFenceEnter, qmdInputRules } from "../../../src/qmd/dom/qmdInputRules";
import { editRequestPlugin, headingToParagraph, QMD_ACTIONS } from "../../../src/qmd/dom/qmdCommands";
import { createCodeCellView } from "../../../src/qmd/dom/codeCellView";
import { createMathView } from "../../../src/qmd/dom/mathView";
import { para, text } from "../../support/nodeViewHarness";

const views: EditorView[] = [];
afterEach(() => {
  while (views.length > 0) views.pop()!.destroy();
  document.body.innerHTML = "";
});

const nodeViews = { code_cell: createCodeCellView(() => undefined), math_inline: createMathView(false, async () => ({ renderMathSvg: () => "<svg></svg>" })), math_display: createMathView(true, async () => ({ renderMathSvg: () => "<svg></svg>" })) };

function mountDoc(doc: PmNode, plugins: Plugin[] = [qmdInputRules(), editRequestPlugin()], cursor?: number): EditorView {
  const host = document.createElement("div");
  document.body.append(host);
  const state = EditorState.create({ doc, plugins });
  // jsdom has no layout, so scrolling the selection into view is skipped as the editor does.
  const view = new EditorView(host, { state: cursor === undefined ? state : state.apply(state.tr.setSelection(TextSelection.create(state.doc, cursor))), nodeViews, handleScrollToSelection: () => true });
  views.push(view);
  return view;
}

/** Types `typed` one character at a time at the cursor, through the input rules as the browser's text input would. */
function type(view: EditorView, typed: string): void {
  for (const char of typed) {
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (handle) => handle(view, from, to, char, () => view.state.tr));
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to));
  }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const emptyDoc = () => s.node("doc", null, [para()]);

describe("Markdown input rules", () => {
  it.each([
    ["**bold** ", "strong", "bold", "**bold** \n"],
    ["__bold__ ", "strong", "bold", "__bold__ \n"],
    ["*it* ", "em", "it", "*it* \n"],
    ["_it_ ", "em", "it", "_it_ \n"],
    ["`x = 1` ", "code", "x = 1", "`x = 1` \n"],
  ])("turns %j into a %s mark with the same written delimiter", (typed, mark, inner, body) => {
    const view = mountDoc(emptyDoc());
    type(view, typed);
    const marked = view.state.doc.firstChild!.firstChild!;
    expect(marked.text).toBe(inner);
    expect(marked.marks.map((m) => m.type.name)).toEqual([mark]);
    expect(view.state.doc.firstChild!.lastChild!.marks).toEqual([]);
    expect(docToBody(view.state.doc)).toBe(body);
  });

  it("leaves underscores inside words alone", () => {
    const view = mountDoc(emptyDoc());
    type(view, "snake_case_name ");
    expect(view.state.doc.firstChild!.firstChild!.marks).toEqual([]);
    expect(view.state.doc.textContent).toBe("snake_case_name ");
  });

  it.each(["``` ", "```python ", "```{python} ", "```py "])("turns %j into a Python cell and puts the caret in its code", async (typed) => {
    const view = mountDoc(emptyDoc());
    type(view, typed);
    const cell = view.state.doc.firstChild!;
    expect(cell.type.name).toBe("code_cell");
    expect(cell.attrs.lang).toBe("python");
    await tick();
    expect(document.activeElement?.closest(".qmd-cell-code")).not.toBeNull();
  });

  it("turns ``` followed by Enter into a Python cell", () => {
    const view = mountDoc(emptyDoc());
    type(view, "```");
    expect(codeFenceEnter(view.state, view.dispatch, view)).toBe(true);
    expect(view.state.doc.firstChild!.type.name).toBe("code_cell");
    expect(docToBody(view.state.doc)).toMatch(/^```\{python\}\n```\n/);
  });

  it("opens the LaTeX field of display math made with $$", async () => {
    const view = mountDoc(emptyDoc());
    type(view, "$$");
    expect(view.state.doc.firstChild!.type.name).toBe("math_display");
    await tick();
    expect(document.activeElement).toBe(view.dom.querySelector('textarea[aria-label="TeX source"]'));
  });

  it("opens an empty display equation for \\[ on an empty line, as $$ does", async () => {
    const view = mountDoc(emptyDoc());
    type(view, "\\[");
    expect(view.state.doc.firstChild!.type.name).toBe("math_display");
    await tick();
    expect(document.activeElement).toBe(view.dom.querySelector('textarea[aria-label="TeX source"]'));
  });
});

describe("LaTeX delimiters typed in text", () => {
  /** The block types of the document, with the caret's block and offset. */
  const shape = (view: EditorView) => view.state.doc.content.content.map((node) => node.type.name);
  const caret = (view: EditorView) => ({ block: view.state.selection.$from.index(0), offset: view.state.selection.$from.parentOffset });

  it("turns \\(tex\\) into inline math stored with dollars, keeping the caret after it", () => {
    const view = mountDoc(emptyDoc());
    type(view, "Area \\(\\pi r^2\\) here");
    const inline = view.state.doc.firstChild!.child(1);
    expect(inline.type.name).toBe("math_inline");
    expect(inline.attrs.tex).toBe("\\pi r^2");
    expect(docToBody(view.state.doc)).toBe("Area $\\pi r^2$ here\n");
  });

  it.each([["$$", "$"], ["\\[", "\\"]])("turns a paragraph holding only %sx^2%s and its closing character into display math and continues below it", (open, close) => {
    // Typing the opener on an empty line already opens an empty equation, so the line holds the rest before its last character.
    const written = `${open}x^2${close}`;
    const view = mountDoc(s.node("doc", null, [para(text(written))]), undefined, written.length + 1);
    type(view, open === "$$" ? "$" : "]");
    expect(shape(view)).toEqual(["math_display", "paragraph"]);
    expect(view.state.doc.firstChild!.attrs.tex).toBe("x^2");
    expect(caret(view)).toEqual({ block: 1, offset: 0 });
    type(view, "Next");
    expect(docToBody(view.state.doc)).toBe("$$x^2$$\n\nNext\n");
  });

  it.each([["$$", "$$"], ["\\[", "\\]"]])("splits the paragraph around %sE = mc^2%s typed mid-text", (open, close) => {
    const view = mountDoc(s.node("doc", null, [para(text("Before  after"))]), undefined, 8);
    type(view, `${open}E = mc^2${close}`);
    expect(shape(view)).toEqual(["paragraph", "math_display", "paragraph"]);
    expect(view.state.doc.child(1).attrs.tex).toBe("E = mc^2");
    expect(caret(view)).toEqual({ block: 2, offset: 0 });
    expect(docToBody(view.state.doc)).toBe("Before \n\n$$E = mc^2$$\n\n after\n");
  });

  it("leaves a lone $ and inline $x$ as they were", () => {
    const view = mountDoc(emptyDoc());
    type(view, "Costs $5 and $x$ ");
    expect(view.state.doc.firstChild!.child(1).type.name).toBe("math_inline");
    expect(docToBody(view.state.doc)).toBe("Costs $5 and $x$ \n");
  });
});

describe("editing commands", () => {
  it("Backspace at the start of a heading makes it a paragraph", () => {
    const view = mountDoc(s.node("doc", null, [s.node("heading", { level: 2 }, [text("Title")])]), [], 1);
    expect(headingToParagraph(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.firstChild!.type.name).toBe("paragraph");
    expect(view.state.doc.textContent).toBe("Title");
  });

  it("Backspace inside a heading is left to the default handling", () => {
    const view = mountDoc(s.node("doc", null, [s.node("heading", { level: 2 }, [text("Title")])]), [], 3);
    expect(headingToParagraph(view.state, view.dispatch)).toBe(false);
  });

  it("an inline equation made from an empty selection opens its LaTeX field", async () => {
    const view = mountDoc(s.node("doc", null, [para(text("see "))]), [editRequestPlugin()], 5);
    QMD_ACTIONS.inlineMath.command(view.state, view.dispatch, view);
    await tick();
    expect(document.activeElement).toBe(view.dom.querySelector('input[aria-label="TeX source"]'));
  });

  it("an inserted code cell takes the caret", async () => {
    const view = mountDoc(emptyDoc(), [editRequestPlugin()], 1);
    QMD_ACTIONS.codeCell.command(view.state, view.dispatch, view);
    await tick();
    expect(document.activeElement?.closest(".qmd-cell-code")).not.toBeNull();
  });
});
