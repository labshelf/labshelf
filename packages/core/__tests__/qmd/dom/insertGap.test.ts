/** @jest-environment jsdom */
/**
 * Tests spec 5.3 (plan D13) through noteLanguageAt and insertGapPlugin (mounted by mountQmdEditor):
 * the language a new cell gets, the "Insert here" gap buttons between blocks and their menu, what a choice inserts and how the body then serialises,
 * the row of four choices on an empty editable note, and read-only views. The Duplicate cases live in insertGap.menu.test.ts.
 *
 * Setups follow cellMenu.test.ts (a real EditorView over the qmd schema, cellText) and qmdEditor.test.ts (mountQmdEditor).
 * Written as if the file sat at packages/core/__tests__/qmd/dom/insertGap.test.ts.
 *
 * What an empty drawing node serialises to was checked with docToBody first: its raw is empty, so the body gains only the blank line gap
 * ("intro\n\n```{python}\nx = 1\n```\n\n\nafter\n" for a drawing between the cell and "after"). An empty paragraph serialises to nothing.
 */
import { TextEncoder as NodeTextEncoder } from "node:util";
import { Fragment, type Node as PmNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { bodyToDoc, docToBody, qmdSchema } from "../../../src/qmd/editor";
import { mountQmdEditor, type QmdEditorHandle } from "../../../src/qmd/dom/qmdEditor";
import { insertGapPlugin, noteLanguageAt } from "../../../src/qmd/dom/insertGap";
import { closeMenu } from "../../../src/ui/dom/widgets/menu";

// jsdom does not expose TextEncoder, which the code hash needs.
if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}

// jsdom has no layout; CodeMirror measures text ranges.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const mounted: QmdEditorHandle[] = [];
const views: EditorView[] = [];
// Every test starts by calling a seam, so while a seam is still a stub each test fails there first, whatever it goes on to check.
beforeEach(() => {
  noteLanguageAt(bodyToDoc("a\n"), 0);
});

afterEach(() => {
  closeMenu();
  while (mounted.length > 0) { try { mounted.pop()!.destroy(); } catch { /* already destroyed */ } }
  while (views.length > 0) views.pop()!.destroy();
  document.body.innerHTML = "";
});

const cellText = (lang: string, label: string | null, code: string): string => `\`\`\`{${lang}}\n${label ? `#| label: ${label}\n` : ""}${code}\n\`\`\`\n`;

const nodes = qmdSchema.nodes;
const childrenOf = (doc: PmNode): PmNode[] => {
  const out: PmNode[] = [];
  doc.forEach((child) => out.push(child));
  return out;
};
/** The offset of each top-level child, then the end of the content: the gap positions 0..childCount. */
const gapPositions = (doc: PmNode): number[] => {
  const out: number[] = [];
  doc.forEach((_child, offset) => out.push(offset));
  out.push(doc.content.size);
  return out;
};
/** What docToBody gives for `body` with `node` inserted as the top-level block at `index`: the body a correct insertion at that gap must produce. */
function bodyWith(body: string, index: number, node: PmNode): string {
  const doc = bodyToDoc(body);
  const kids = childrenOf(doc);
  kids.splice(index, 0, node);
  return docToBody(doc.copy(Fragment.from(kids)));
}

// ---------------------------------------------------------------------------------------------------------------- mountQmdEditor side

interface Mounted { root: HTMLElement; handle: QmdEditorHandle; changes: string[] }
function setup(body: string, extra: { readOnly?: boolean } = {}): Mounted {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const changes: string[] = [];
  const handle = mountQmdEditor(root, { body, onChange: (next) => changes.push(next), ...extra });
  mounted.push(handle);
  return { root, handle, changes };
}
/** The body the editor reports once its pending change is flushed. */
function bodyOf({ handle, changes }: Mounted): string {
  handle.flush();
  const last = changes[changes.length - 1];
  if (last === undefined) throw new Error("the editor reported no change");
  return last;
}

const surface = (root: HTMLElement): HTMLElement => root.querySelector<HTMLElement>(".ProseMirror")!;
const gapButtons = (root: HTMLElement): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>(".qmd-insert-gap")];
/** The number of top-level blocks before `button` in the document, that is, the gap it stands in (0 is before the first block). */
function gapIndexOf(root: HTMLElement, button: HTMLElement): number {
  const pm = surface(root);
  const buttons = gapButtons(root);
  const blocks = [...pm.children].filter((child) => !buttons.some((b) => child === b || child.contains(b)));
  return blocks.filter((block) => (block.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).length;
}
function gapButton(root: HTMLElement, index: number): HTMLButtonElement {
  const hit = gapButtons(root).find((button) => gapIndexOf(root, button) === index);
  if (!hit) throw new Error(`no gap button at gap ${index}`);
  return hit;
}
/** The open Insert panel as "<section>: <choice>, …" lines. */
const menuLabels = (): string[] =>
  [...document.querySelectorAll<HTMLElement>(".ls-section-panel-section")].map((section) =>
    `${section.querySelector("h3")!.textContent}: ${[...section.querySelectorAll("button span")].map((label) => label.textContent).join(", ")}`);
const GAP_STYLES = ["Heading: Heading 1, Heading 2, Heading 3", "List: Bullets, Numbered, Tasks"];
const GAP_BLOCKS = "Math and diagrams: Equation, Diagram";
const menuItem = (label: string): HTMLButtonElement => {
  const hit = [...document.querySelectorAll<HTMLButtonElement>(".ls-section-panel button")].find((item) => item.querySelector("span")?.textContent === label);
  if (!hit) throw new Error(`no menu item ${label}`);
  return hit;
};
const choiceButtons = (root: HTMLElement): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>(".qmd-empty-choices button")];
const choiceLabel = (button: HTMLElement): string => (button.textContent?.trim() || button.getAttribute("aria-label") || "").trim();
const choice = (root: HTMLElement, label: string): HTMLButtonElement => {
  const hit = choiceButtons(root).find((button) => choiceLabel(button) === label);
  if (!hit) throw new Error(`no empty-note choice ${label}`);
  return hit;
};

/** intro, a python cell, after. Gaps: 0 before intro, 1 between intro and the cell, 2 between the cell and after, 3 after the last. */
const PY_NOTE = `intro\n\n${cellText("python", null, "x = 1")}\nafter\n`;
const R_NOTE = `intro\n\n${cellText("r", null, "cat(1)")}\nafter\n`;
const PLAIN_NOTE = "one\n\ntwo\n";

// ---------------------------------------------------------------------------------------------------------------- noteLanguageAt

describe("noteLanguageAt", () => {
  // paragraph a, r cell, paragraph b, python cell, paragraph c
  const doc = bodyToDoc(`a\n\n${cellText("r", null, "cat(1)")}\nb\n\n${cellText("python", null, "x = 1")}\nc\n`);
  const gaps = gapPositions(doc);

  it("5.3a is the language of the nearest code cell before the position", () => {
    expect(noteLanguageAt(doc, gaps[2]!)).toBe("r");
    expect(noteLanguageAt(doc, gaps[4]!)).toBe("python");
    expect(noteLanguageAt(doc, gaps[5]!)).toBe("python");
  });

  it("5.3a prefers the cell before the position over a nearer one after it", () => {
    // Gap 3 sits between paragraph b and the python cell: the r cell is before it.
    expect(noteLanguageAt(doc, gaps[3]!)).toBe("r");
  });

  it("5.3a falls back to the nearest code cell after the position when none is before", () => {
    expect(noteLanguageAt(doc, gaps[0]!)).toBe("r");
    expect(noteLanguageAt(doc, gaps[1]!)).toBe("r");
    const rOnlyAfter = bodyToDoc(`a\n\n${cellText("mathematica", null, "1+1")}`);
    expect(noteLanguageAt(rOnlyAfter, 0)).toBe("mathematica");
  });

  it("5.3a defaults to python in a note without code cells", () => {
    const plain = bodyToDoc(PLAIN_NOTE);
    for (const pos of gapPositions(plain)) expect(noteLanguageAt(plain, pos)).toBe("python");
  });
});

// ---------------------------------------------------------------------------------------------------------------- the gap buttons

describe("the gap buttons", () => {
  it("5.3a puts an 'Insert here' button of class qmd-insert-gap in the gap between two blocks", () => {
    const { root } = setup(PY_NOTE);
    const between = gapButtons(root).filter((button) => [1, 2].includes(gapIndexOf(root, button)));
    expect(between.map((button) => gapIndexOf(root, button)).sort()).toEqual([1, 2]);
    for (const button of between) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("aria-label")).toBe("Insert here");
    }
  });

  it("5.3a puts exactly one button in each gap between blocks", () => {
    const { root } = setup(PY_NOTE);
    const indexes = gapButtons(root).map((button) => gapIndexOf(root, button));
    expect(indexes.filter((index) => index === 1)).toHaveLength(1);
    expect(indexes.filter((index) => index === 2)).toHaveLength(1);
  });

  it("5.3a leaves the gap buttons reachable by Tab", () => {
    const { root } = setup(PY_NOTE);
    const button = gapButton(root, 1);
    expect(button.getAttribute("tabindex")).not.toBe("-1");
    expect(button.disabled).toBe(false);
  });

  it("5.3a opens the Insert panel: text and list styles, the code cells with Python first after a python cell, then Equation and Drawing", () => {
    const { root } = setup(PY_NOTE);
    gapButton(root, 2).click();
    expect(menuLabels()).toEqual([...GAP_STYLES, "Code cell: Python, Mathematica, R", GAP_BLOCKS]);
  });

  it("5.3a lists the language of the cell before the gap first", () => {
    const { root } = setup(R_NOTE);
    gapButton(root, 2).click();
    expect(menuLabels()).toEqual([...GAP_STYLES, "Code cell: R, Python, Mathematica", GAP_BLOCKS]);
  });

  it("5.3a lists the language of the next cell first when no cell is before the gap", () => {
    const { root } = setup(R_NOTE);
    gapButton(root, 1).click();
    expect(menuLabels()[2]).toBe("Code cell: R, Python, Mathematica");
  });

  it("5.3a lists Python first in a note without cells", () => {
    const { root } = setup(PLAIN_NOTE);
    gapButton(root, 1).click();
    expect(menuLabels()).toEqual([...GAP_STYLES, "Code cell: Python, Mathematica, R", GAP_BLOCKS]);
  });
});

// ---------------------------------------------------------------------------------------------------------------- choosing at a gap

describe("choosing from a gap menu", () => {
  it("5.3a Cell (Python) between a python cell and a paragraph inserts a ```{python} fence there", () => {
    const m = setup(PY_NOTE);
    gapButton(m.root, 2).click();
    menuItem("Python").click();
    const body = bodyOf(m);
    expect(body).toContain("```{python}\n```");
    expect(body).toBe(bodyWith(PY_NOTE, 2, nodes.code_cell!.create({ lang: "python" })));
    expect(body.indexOf("x = 1")).toBeLessThan(body.indexOf("```{python}\n```"));
    expect(body.indexOf("```{python}\n```")).toBeLessThan(body.indexOf("after"));
  });

  it("5.3a a cell of another language inserts a fence of that language at the gap", () => {
    const m = setup(PY_NOTE);
    gapButton(m.root, 2).click();
    menuItem("R").click();
    expect(bodyOf(m)).toBe(bodyWith(PY_NOTE, 2, nodes.code_cell!.create({ lang: "r" })));
    expect(bodyOf(m)).toContain("```{r}\n```");
  });

  it("5.3a Equation inserts an empty $$ $$ block at the gap", () => {
    const m = setup(PY_NOTE);
    gapButton(m.root, 2).click();
    menuItem("Equation").click();
    const body = bodyOf(m);
    expect(body).toBe(bodyWith(PY_NOTE, 2, nodes.math_display!.create()));
    expect(body).toMatch(/```\n\n\$\$\s*\$\$\n\nafter\n$/);
  });

  it("5.3a Drawing inserts an empty drawing block at the gap", () => {
    const m = setup(PY_NOTE);
    gapButton(m.root, 2).click();
    menuItem("Diagram").click();
    // An empty drawing node serialises to nothing but its blank-line gap (checked with docToBody).
    expect(bodyOf(m)).toBe("intro\n\n```{python}\nx = 1\n```\n\n\nafter\n");
    expect(bodyOf(m)).toBe(bodyWith(PY_NOTE, 2, nodes.drawing!.create({ raw: "" })));
  });

  it("5.3a Heading 2 adds a heading after the block before the gap and puts the caret in it", () => {
    const { root } = setup(PY_NOTE);
    gapButton(root, 2).click();
    menuItem("Heading 2").click();
    const heading = surface(root).querySelector(":scope > h2")!;
    expect(heading.previousElementSibling?.matches(".qmd-cell, .qmd-output, .qmd-insert-gap")).toBe(true);
    const anchor = document.getSelection()!.anchorNode;
    expect(heading === anchor || heading.contains(anchor)).toBe(true);
  });

  it("5.3a a choice inserts between the neighbours and keeps both of them", () => {
    const m = setup(PY_NOTE);
    gapButton(m.root, 1).click();
    menuItem("Equation").click();
    const body = bodyOf(m);
    expect(body).toBe(bodyWith(PY_NOTE, 1, nodes.math_display!.create()));
    expect(body.indexOf("intro")).toBeLessThan(body.indexOf("$$"));
    expect(body.indexOf("$$")).toBeLessThan(body.indexOf("```{python}\nx = 1"));
    expect(body).toContain("after");
  });

  it("5.3a the menu closes after a choice", () => {
    const { root } = setup(PY_NOTE);
    gapButton(root, 2).click();
    menuItem("Equation").click();
    expect(document.querySelector(".ls-section-panel")).toBeNull();
  });

  it("A11 inserts a cell between blocks and the note stays standard Quarto", () => {
    const m = setup(PY_NOTE);
    gapButton(m.root, 2).click();
    menuItem("Python").click();
    const doc = bodyToDoc(bodyOf(m));
    expect(childrenOf(doc).map((child) => child.type.name)).toEqual(["paragraph", "code_cell", "code_cell", "paragraph"]);
    expect(docToBody(doc)).toBe(bodyOf(m));
  });
});

// ---------------------------------------------------------------------------------------------------------------- read-only

describe("a read-only view", () => {
  it("5.3a shows no gap buttons", () => {
    const { root } = setup(PY_NOTE, { readOnly: true });
    expect(surface(root).textContent).toContain("intro");
    expect(root.querySelector(".qmd-insert-gap")).toBeNull();
    expect(root.querySelector('[aria-label="Insert here"]')).toBeNull();
  });

  it("5.3b shows no empty-note choices on an empty read-only note", () => {
    const { root } = setup("", { readOnly: true });
    expect(root.querySelector(".qmd-empty-choices")).toBeNull();
    expect(root.querySelector(".qmd-insert-gap")).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------- the empty note

describe("an empty editable note", () => {
  it("5.3b shows a row of three choices: Cell (Python), Equation, Diagram (its paragraph already takes text)", () => {
    const { root } = setup("");
    expect(root.querySelectorAll(".qmd-empty-choices")).toHaveLength(1);
    expect(choiceButtons(root).map(choiceLabel)).toEqual(["Cell (Python)", "Equation", "Diagram"]);
  });

  it("5.3b the choices are buttons that Tab can reach", () => {
    const { root } = setup("");
    for (const button of choiceButtons(root)) {
      expect(button.disabled).toBe(false);
      expect(button.getAttribute("tabindex")).not.toBe("-1");
    }
  });

  it("5.3b Cell (Python) turns the empty note into a python cell and the row goes", () => {
    const m = setup("");
    choice(m.root, "Cell (Python)").click();
    expect(bodyOf(m)).toMatch(/^```\{python\}\n```\s*$/);
    expect(m.root.querySelector(".qmd-empty-choices")).toBeNull();
  });

  it("5.3b Equation turns the empty note into an equation and the row goes", () => {
    const m = setup("");
    choice(m.root, "Equation").click();
    expect(bodyOf(m)).toMatch(/^\$\$\s*\$\$\s*$/);
    expect(m.root.querySelector(".qmd-empty-choices")).toBeNull();
  });

  it("5.3b Diagram replaces the empty paragraph and the row goes", () => {
    const { root } = setup("");
    choice(root, "Diagram").click();
    expect(root.querySelector(".qmd-empty-choices")).toBeNull();
  });

  it("5.3b the row goes once the body has content", () => {
    const { root, handle } = setup("");
    expect(root.querySelector(".qmd-empty-choices")).not.toBeNull();
    handle.setBody("Some text\n");
    expect(root.querySelector(".qmd-empty-choices")).toBeNull();
  });

  it("5.3b shows no row on a note that starts with content", () => {
    const { root } = setup("Hello\n");
    expect(root.querySelector(".qmd-empty-choices")).toBeNull();
  });

  it("A11 inserts on an empty note: the choices appear, one inserts a cell and the note is standard Quarto", () => {
    const m = setup("");
    expect(choiceButtons(m.root)).toHaveLength(3);
    choice(m.root, "Cell (Python)").click();
    const doc = bodyToDoc(bodyOf(m));
    expect(childrenOf(doc)[0]!.type.name).toBe("code_cell");
    expect(childrenOf(doc)[0]!.attrs.lang).toBe("python");
  });
});

// ---------------------------------------------------------------------------------------------------------------- the plugin on its own

describe("insertGapPlugin", () => {
  it("5.3a returns a plugin a view can take", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const view = new EditorView(host, { state: EditorState.create({ doc: bodyToDoc(PY_NOTE), plugins: [insertGapPlugin()] }) });
    views.push(view);
    expect(view.dom.querySelectorAll(".qmd-insert-gap").length).toBeGreaterThanOrEqual(2);
  });
});
