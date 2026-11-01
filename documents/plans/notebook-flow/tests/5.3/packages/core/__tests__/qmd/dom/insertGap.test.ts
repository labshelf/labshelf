/** @jest-environment jsdom */
/**
 * Tests spec 5.3 (plan D13) through noteLanguageAt, insertGapPlugin (mounted by mountQmdEditor), duplicateCell and the cell menu:
 * the language a new cell gets, the "Insert here" gap buttons between blocks and their menu, what a choice inserts and how the body then serialises,
 * the row of four choices on an empty editable note, read-only views, and Duplicate on a code cell.
 *
 * Setups follow cellMenu.test.ts (a real EditorView over the qmd schema, cellText/outputText through formatOutput) and qmdEditor.test.ts (mountQmdEditor).
 * Written as if the file sat at packages/core/__tests__/qmd/dom/insertGap.test.ts.
 *
 * What an empty drawing node serialises to was checked with docToBody first: its raw is empty, so the body gains only the blank line gap
 * ("intro\n\n```{python}\nx = 1\n```\n\n\nafter\n" for a drawing between the cell and "after"). An empty paragraph serialises to nothing.
 */
import { TextEncoder as NodeTextEncoder } from "node:util";
import { Fragment, type Node as PmNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { EditorView } from "prosemirror-view";
import { bodyToDoc, docToBody, qmdSchema } from "../../../src/qmd/editor";
import { deriveCodeHash, formatOutput } from "../../../src/qmd/item/cellOutput";
import { mountQmdEditor, type QmdEditorHandle } from "../../../src/qmd/dom/qmdEditor";
import { cellMenuEntries, duplicateCell } from "../../../src/qmd/dom/cellMenu";
import { insertGapPlugin, noteLanguageAt } from "../../../src/qmd/dom/insertGap";
import { closeMenu, type MenuEntry, type MenuItem } from "../../../src/ui/dom/widgets/menu";

// jsdom does not expose TextEncoder, which the code hash needs.
if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}

// jsdom has no layout; CodeMirror measures text ranges.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const RAN = "2026-10-22T09:15:03.000Z";
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
const outputText = async (label: string, code: string, content: string): Promise<string> =>
  formatOutput({ cell: label, source: await deriveCodeHash(code + "\n"), engine: "python-3.12", ran: RAN, content });

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
const menuLabels = (): string[] =>
  [...document.querySelectorAll<HTMLElement>(".ls-menu > *")].map((child) => (child.getAttribute("role") === "separator" ? "---" : child.querySelector(".ls-menu-label")!.textContent!));
const menuItem = (label: string): HTMLButtonElement => {
  const hit = [...document.querySelectorAll<HTMLButtonElement>(".ls-menu-item")].find((item) => item.querySelector(".ls-menu-label")?.textContent === label);
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

  it("5.3a opens a menu of Cell (Python), Equation, Drawing, Text, a separator and the other languages after a python cell", () => {
    const { root } = setup(PY_NOTE);
    gapButton(root, 2).click();
    expect(menuLabels()).toEqual(["Cell (Python)", "Equation", "Drawing", "Text", "---", "Cell (Mathematica)", "Cell (R)"]);
  });

  it("5.3a lists the language of the cell before the gap first", () => {
    const { root } = setup(R_NOTE);
    gapButton(root, 2).click();
    expect(menuLabels()).toEqual(["Cell (R)", "Equation", "Drawing", "Text", "---", "Cell (Python)", "Cell (Mathematica)"]);
  });

  it("5.3a lists the language of the next cell first when no cell is before the gap", () => {
    const { root } = setup(R_NOTE);
    gapButton(root, 1).click();
    expect(menuLabels()[0]).toBe("Cell (R)");
  });

  it("5.3a lists Cell (Python) first in a note without cells", () => {
    const { root } = setup(PLAIN_NOTE);
    gapButton(root, 1).click();
    expect(menuLabels()).toEqual(["Cell (Python)", "Equation", "Drawing", "Text", "---", "Cell (Mathematica)", "Cell (R)"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------- choosing at a gap

describe("choosing from a gap menu", () => {
  it("5.3a Cell (Python) between a python cell and a paragraph inserts a ```{python} fence there", () => {
    const m = setup(PY_NOTE);
    gapButton(m.root, 2).click();
    menuItem("Cell (Python)").click();
    const body = bodyOf(m);
    expect(body).toContain("```{python}\n```");
    expect(body).toBe(bodyWith(PY_NOTE, 2, nodes.code_cell!.create({ lang: "python" })));
    expect(body.indexOf("x = 1")).toBeLessThan(body.indexOf("```{python}\n```"));
    expect(body.indexOf("```{python}\n```")).toBeLessThan(body.indexOf("after"));
  });

  it("5.3a a cell of another language inserts a fence of that language at the gap", () => {
    const m = setup(PY_NOTE);
    gapButton(m.root, 2).click();
    menuItem("Cell (R)").click();
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
    menuItem("Drawing").click();
    // An empty drawing node serialises to nothing but its blank-line gap (checked with docToBody).
    expect(bodyOf(m)).toBe("intro\n\n```{python}\nx = 1\n```\n\n\nafter\n");
    expect(bodyOf(m)).toBe(bodyWith(PY_NOTE, 2, nodes.drawing!.create({ raw: "" })));
  });

  it("5.3a Text inserts an empty paragraph at the gap and leaves the body unchanged", () => {
    const m = setup(PY_NOTE);
    const before = surface(m.root).querySelectorAll(":scope > p").length;
    gapButton(m.root, 2).click();
    menuItem("Text").click();
    expect(surface(m.root).querySelectorAll(":scope > p")).toHaveLength(before + 1);
    expect(bodyOf(m)).toBe(bodyWith(PY_NOTE, 2, nodes.paragraph!.create()));
  });

  it("5.3a Text puts the caret into the new empty paragraph", () => {
    const { root } = setup(PY_NOTE);
    gapButton(root, 2).click();
    menuItem("Text").click();
    const empty = [...surface(root).querySelectorAll(":scope > p")].find((p) => p.textContent === "")!;
    expect(empty).toBeDefined();
    const anchor = document.getSelection()!.anchorNode;
    expect(anchor).not.toBeNull();
    expect(empty === anchor || empty.contains(anchor)).toBe(true);
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
    expect(document.querySelector(".ls-menu")).toBeNull();
  });

  it("A11 inserts a cell between blocks and the note stays standard Quarto", () => {
    const m = setup(PY_NOTE);
    gapButton(m.root, 2).click();
    menuItem("Cell (Python)").click();
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
  it("5.3b shows a row of four choices: Cell (Python), Equation, Drawing, Text", () => {
    const { root } = setup("");
    expect(root.querySelectorAll(".qmd-empty-choices")).toHaveLength(1);
    expect(choiceButtons(root).map(choiceLabel)).toEqual(["Cell (Python)", "Equation", "Drawing", "Text"]);
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

  it("5.3b Drawing replaces the empty paragraph and the row goes", () => {
    const { root } = setup("");
    choice(root, "Drawing").click();
    expect(root.querySelector(".qmd-empty-choices")).toBeNull();
  });

  it("5.3b Text focuses the paragraph of the editor", () => {
    const { root } = setup("");
    choice(root, "Text").click();
    expect(document.activeElement).toBe(surface(root));
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
    expect(choiceButtons(m.root)).toHaveLength(4);
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

// ---------------------------------------------------------------------------------------------------------------- Duplicate

/** first (labelled, with two outputs), a paragraph, an unlabelled cell without output, a paragraph. */
async function noteBody(): Promise<string> {
  return [
    cellText("python", "first", "x = 1"), await outputText("first", "x = 1", "one\n"), await outputText("first", "x = 1", "again\n"),
    "between\n",
    cellText("python", null, "y = 2"),
    "tail\n",
  ].join("\n");
}

function mountBody(body: string): EditorView {
  const host = document.createElement("div");
  document.body.append(host);
  const view: EditorView = new EditorView(host, {
    state: EditorState.create({ doc: bodyToDoc(body), plugins: [history()] }),
    dispatchTransaction(tr) { view.updateState(view.state.apply(tr)); },
  });
  views.push(view);
  return view;
}
interface Found { node: PmNode; pos: number }
function blocks(view: EditorView): Found[] {
  const out: Found[] = [];
  view.state.doc.forEach((node, pos) => out.push({ node, pos }));
  return out;
}
const typesOf = (view: EditorView): string[] => blocks(view).map((b) => b.node.type.name);
const cellsOf = (view: EditorView): Found[] => blocks(view).filter((b) => b.node.type.name === "code_cell");
const bodyOfView = (view: EditorView): string => docToBody(view.state.doc);
const entryLabels = (entries: MenuEntry[]): string[] => entries.map((e) => (e === "separator" ? "---" : e.label));
const entry = (entries: MenuEntry[], label: string): MenuItem => {
  const hit = entries.find((candidate): candidate is MenuItem => candidate !== "separator" && candidate.label === label);
  if (!hit) throw new Error(`no entry ${label}`);
  return hit;
};

describe("duplicateCell", () => {
  it("5.3c adds an unlabelled copy without outputs after the outputs of a labelled cell", async () => {
    const view = mountBody(await noteBody());
    expect(duplicateCell(view, cellsOf(view)[0]!.pos)).toBe(true);
    expect(typesOf(view)).toEqual(["code_cell", "output", "output", "code_cell", "paragraph", "code_cell", "paragraph"]);
    const [original, copy] = [blocks(view)[0]!.node, blocks(view)[3]!.node];
    expect(original.attrs.options).toContain("label: first");
    expect(copy.attrs.lang).toBe(original.attrs.lang);
    expect(copy.attrs.code).toBe(original.attrs.code);
    expect(copy.attrs.options).not.toContain("label");
  });

  it("5.3c leaves the original and its two outputs as they were", async () => {
    const view = mountBody(await noteBody());
    const before = blocks(view).slice(0, 3).map((b) => b.node);
    duplicateCell(view, cellsOf(view)[0]!.pos);
    const after = blocks(view).slice(0, 3).map((b) => b.node);
    expect(after.every((node, index) => node.eq(before[index]!))).toBe(true);
  });

  it("5.3c the copy serialises as a plain unlabelled fence and the body has no second label", async () => {
    const view = mountBody(await noteBody());
    duplicateCell(view, cellsOf(view)[0]!.pos);
    const body = bodyOfView(view);
    expect(body.match(/#\| label: first/g)).toHaveLength(1);
    expect(body).toContain("```{python}\nx = 1\n```");
    expect(body.match(/```\{python\}/g)).toHaveLength(3);
  });

  it("5.3c keeps the other options of the cell and drops only the label", () => {
    const view = mountBody("```{python}\n#| label: a\n#| echo: false\nx = 1\n```\n");
    duplicateCell(view, cellsOf(view)[0]!.pos);
    const copy = cellsOf(view)[1]!.node;
    expect(copy.attrs.options).toContain("echo: false");
    expect(copy.attrs.options).not.toContain("label");
  });

  it("5.3c copies a cell without outputs right after it", async () => {
    const view = mountBody(await noteBody());
    expect(duplicateCell(view, cellsOf(view)[1]!.pos)).toBe(true);
    expect(typesOf(view)).toEqual(["code_cell", "output", "output", "paragraph", "code_cell", "code_cell", "paragraph"]);
    expect(cellsOf(view)[2]!.node.attrs.code).toBe(cellsOf(view)[1]!.node.attrs.code);
  });

  it("5.3c is one undo step", async () => {
    const view = mountBody(await noteBody());
    const before = bodyOfView(view);
    duplicateCell(view, cellsOf(view)[0]!.pos);
    expect(bodyOfView(view)).not.toBe(before);
    expect(undo(view.state, view.dispatch.bind(view))).toBe(true);
    expect(bodyOfView(view)).toBe(before);
  });

  it("5.3c returns false and changes nothing when the position is a paragraph", async () => {
    const view = mountBody(await noteBody());
    const before = bodyOfView(view);
    const paragraph = blocks(view).find((b) => b.node.type.name === "paragraph")!;
    expect(duplicateCell(view, paragraph.pos)).toBe(false);
    expect(bodyOfView(view)).toBe(before);
  });

  it("5.3c returns false and changes nothing when the position is an output", async () => {
    const view = mountBody(await noteBody());
    const before = bodyOfView(view);
    const output = blocks(view).find((b) => b.node.type.name === "output")!;
    expect(duplicateCell(view, output.pos)).toBe(false);
    expect(bodyOfView(view)).toBe(before);
  });
});

describe("the cell menu Duplicate entry", () => {
  it("5.3c comes right after Collapse cell in cellMenuEntries", async () => {
    const view = mountBody(await noteBody());
    const labels = entryLabels(cellMenuEntries(view, () => cellsOf(view)[0]!.pos, undefined));
    expect(labels).toContain("Duplicate");
    expect(labels.indexOf("Duplicate")).toBe(labels.indexOf("Collapse cell") + 1);
    expect(labels.indexOf("Change language")).toBeGreaterThan(labels.indexOf("Duplicate"));
  });

  it("5.3c is an enabled, non-danger entry even without a runner", async () => {
    const view = mountBody(await noteBody());
    const duplicate = entry(cellMenuEntries(view, () => cellsOf(view)[0]!.pos, undefined), "Duplicate");
    expect(duplicate.disabled).toBeFalsy();
    expect(duplicate.danger).toBeFalsy();
  });

  it("5.3c selecting it duplicates the cell of the menu", async () => {
    const view = mountBody(await noteBody());
    entry(cellMenuEntries(view, () => cellsOf(view)[0]!.pos, undefined), "Duplicate").onSelect();
    expect(typesOf(view)).toEqual(["code_cell", "output", "output", "code_cell", "paragraph", "code_cell", "paragraph"]);
    expect(blocks(view)[3]!.node.attrs.options).not.toContain("label");
  });

  it("A11 duplicate from the opened cell menu in the editor adds a copy without outputs or label", async () => {
    const body = await noteBody();
    const m = setup(body);
    const button = surface(m.root).querySelector<HTMLButtonElement>(".qmd-cell .qmd-cell-menu")!;
    button.click();
    const labels = menuLabels();
    expect(labels.indexOf("Duplicate")).toBe(labels.indexOf("Collapse cell") + 1);
    menuItem("Duplicate").click();
    const doc = bodyToDoc(bodyOf(m));
    expect(childrenOf(doc).map((child) => child.type.name)).toEqual(["code_cell", "output", "output", "code_cell", "paragraph", "code_cell", "paragraph"]);
    expect(childrenOf(doc)[3]!.attrs.options).not.toContain("label");
    expect(childrenOf(doc)[3]!.attrs.code).toBe(childrenOf(doc)[0]!.attrs.code);
  });
});
