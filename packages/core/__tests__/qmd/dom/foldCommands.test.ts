/** @jest-environment jsdom */
/**
 * Tests the fold commands (D8, D14): collapseAll, expandAll and setReading on a view with foldPlugin, the is-reading class on the editor root,
 * the Reading mode DOM, and the heading chevron button (aria-label 'Collapse section' / 'Expand section'). The QmdEditorHandle methods
 * (collapseAll, expandAll, setReading, foldState) are thin wrappers over these functions and are not tested separately.
 *
 * Fold keys follow 3.1: a cell's key is its label, else cell-<n> (1-based among the code cells); a section's key is sectionKey(level, text, occurrence).
 * Sticky headings and the hiding of code in Reading mode are CSS only and are not tested here; the tests check the state, the class on the root,
 * and that outputs stay in the DOM unmarked.
 */
import type { Node as PmNode } from "prosemirror-model";
import { EditorState, type Plugin } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { formatOutput } from "../../../src/qmd/item/cellOutput";
import { createCodeCellView } from "../../../src/qmd/dom/codeCellView";
import { createOutputView } from "../../../src/qmd/dom/outputView";
import { collapseAll, expandAll, foldPlugin, foldStateOf, setFold, setReading, type FoldState } from "../../../src/qmd/dom/foldPlugin";
import { sectionKey } from "../../../src/qmd/dom/notebookCells";
import { bodyToDoc, docToBody } from "../../../src/qmd/editor";

// jsdom has no layout; CodeMirror measures text ranges.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const RAN = "2026-10-22T09:15:03.000Z";
const fence = (code: string, label?: string): string => `\`\`\`{python}\n${label ? `#| label: ${label}\n` : ""}${code}\n\`\`\`\n`;
const output = (cell: string, content: string): string => formatOutput({ cell, source: "0123456789ab", engine: "python-3.12", ran: RAN, content });

/** A cell outside any section with an output, then two level-1 sections; the first holds a level-2 section with a level-3 heading and an unlabelled cell. */
const BODY = [
  fence("x = 1", "lead"), output("lead", "lead-result\n"),
  "# Top\n", "top text\n",
  "## Sub\n", "sub text\n", fence("y = 2"),
  "### Deep\n", "deep text\n",
  "# Second\n", "second text\n",
].join("\n");

const TOP = sectionKey(1, "Top", 0);
const SUB = sectionKey(2, "Sub", 0);
const SECOND = sectionKey(1, "Second", 0);

const sorted = (set: ReadonlySet<string>): string[] => [...set].sort();
const state = (view: EditorView): FoldState => foldStateOf(view.state);

const views: EditorView[] = [];
afterEach(() => {
  while (views.length > 0) views.pop()!.destroy();
  document.body.innerHTML = "";
});

/** A bare view with foldPlugin, mounted in a .qmd-editor element as the editor does. */
function mountView(body = BODY): { view: EditorView; root: HTMLElement } {
  const root = document.createElement("div");
  root.className = "qmd-editor";
  document.body.append(root);
  const doc: PmNode = bodyToDoc(body);
  const view = new EditorView(root, {
    state: EditorState.create({ doc, plugins: [foldPlugin() as unknown as Plugin] }),
    nodeViews: { code_cell: createCodeCellView(), output: createOutputView(async () => ({ renderMathSvg: () => "<svg></svg>" })) },
  });
  views.push(view);
  return { view, root };
}

describe("collapseAll", () => {
  it("3.2a collapses every top-level section and every cell outside a section, and nothing nested", () => {
    const { view } = mountView();
    collapseAll(view);
    expect(sorted(state(view).sections)).toEqual([SECOND, TOP].sort());
    expect(sorted(state(view).cells)).toEqual(["lead"]);
    expect(state(view).sections.has(SUB)).toBe(false);
  });

  it("3.2a marks the collapsed cell and headings in the DOM", () => {
    const { view } = mountView();
    collapseAll(view);
    const headings = [...view.dom.querySelectorAll("h1")];
    expect(headings).toHaveLength(2);
    expect(headings.every((h) => h.classList.contains("qmd-section-collapsed"))).toBe(true);
    expect(view.dom.querySelectorAll(".qmd-collapsed").length).toBeGreaterThanOrEqual(1);
    expect(view.dom.querySelector("h2")!.classList.contains("qmd-in-collapsed-section")).toBe(true);
  });

  it("3.2a leaves the Reading mode as it was", () => {
    const { view } = mountView();
    setReading(view, true);
    collapseAll(view);
    expect(state(view).reading).toBe(true);
  });

  it("3.2a changes nothing in the document", () => {
    const { view } = mountView();
    const before = view.state.doc;
    const body = docToBody(before);
    collapseAll(view);
    expect(view.state.doc.eq(before)).toBe(true);
    expect(docToBody(view.state.doc)).toBe(body);
  });
});

describe("expandAll", () => {
  it("3.2a after collapseAll restores the starting fold state", () => {
    const { view } = mountView();
    const start = state(view);
    collapseAll(view);
    expandAll(view);
    expect(sorted(state(view).cells)).toEqual(sorted(start.cells));
    expect(sorted(state(view).sections)).toEqual(sorted(start.sections));
    expect(state(view).reading).toBe(start.reading);
  });

  it("3.2a clears cells and sections collapsed one by one, including nested ones", () => {
    const { view } = mountView();
    setFold(view, { cell: ["cell-2", true] });
    setFold(view, { section: [SUB, true] });
    setFold(view, { section: [SECOND, true] });
    expandAll(view);
    expect(state(view).cells.size).toBe(0);
    expect(state(view).sections.size).toBe(0);
  });

  it("3.2a removes the collapse classes from the DOM", () => {
    const { view } = mountView();
    collapseAll(view);
    expandAll(view);
    expect(view.dom.querySelector(".qmd-collapsed")).toBeNull();
    expect(view.dom.querySelector(".qmd-section-collapsed")).toBeNull();
    expect(view.dom.querySelector(".qmd-in-collapsed-section")).toBeNull();
  });

  it("3.2a does not turn Reading mode off", () => {
    const { view } = mountView();
    setReading(view, true);
    collapseAll(view);
    expandAll(view);
    expect(state(view).reading).toBe(true);
  });
});

describe("setReading", () => {
  it("3.2a sets and clears the reading flag of the fold state", () => {
    const { view } = mountView();
    expect(state(view).reading).toBe(false);
    setReading(view, true);
    expect(state(view).reading).toBe(true);
    setReading(view, false);
    expect(state(view).reading).toBe(false);
  });

  it("3.2a adds and removes is-reading on the editor root element", () => {
    const { view, root } = mountView();
    setReading(view, true);
    expect(root.classList.contains("is-reading")).toBe(true);
    setReading(view, false);
    expect(root.classList.contains("is-reading")).toBe(false);
  });

  it("3.2a does not change which cells and sections are collapsed", () => {
    const { view } = mountView();
    setFold(view, { cell: ["lead", true] });
    setFold(view, { section: [TOP, true] });
    setReading(view, true);
    expect(sorted(state(view).cells)).toEqual(["lead"]);
    expect(sorted(state(view).sections)).toEqual([TOP]);
  });

  it("3.2a changes nothing in the document", () => {
    const { view } = mountView();
    const before = view.state.doc;
    setReading(view, true);
    expect(view.state.doc.eq(before)).toBe(true);
  });
});

describe("Reading mode DOM", () => {
  it("3.2a the output stays in the DOM and is not collapsed", () => {
    const { view } = mountView();
    setReading(view, true);
    expect(view.dom.querySelectorAll(".qmd-output-text").length).toBeGreaterThanOrEqual(1);
    expect(view.dom.querySelector(".qmd-collapsed-output")).toBeNull();
    expect(view.dom.querySelector(".qmd-in-collapsed-section")).toBeNull();
    expect(view.dom.textContent).toContain("lead-result");
  });

  it("3.2a text between the cells stays in the DOM", () => {
    const { view } = mountView();
    setReading(view, true);
    expect(view.dom.textContent).toContain("top text");
    expect(view.dom.textContent).toContain("second text");
  });

  it("3.2a a code cell without output shows its summary line", () => {
    const { view } = mountView(`${fence("z = 3", "bare")}\n`);
    setReading(view, true);
    const summary = view.dom.querySelector<HTMLElement>(".qmd-cell-summary");
    expect(summary).not.toBeNull();
    expect(summary!.textContent).toMatch(/not run/i);
  });

  it("3.2a leaving Reading mode removes that summary line again", () => {
    const { view } = mountView(`${fence("z = 3", "bare")}\n`);
    setReading(view, true);
    setReading(view, false);
    expect(view.dom.querySelector(".qmd-cell-summary")).toBeNull();
  });
});

describe("heading chevron", () => {
  const chevrons = (root: HTMLElement): HTMLButtonElement[] =>
    [...root.querySelectorAll<HTMLButtonElement>("button[aria-label='Collapse section'], button[aria-label='Expand section']")];
  const headings = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")];
  /** The chevron of the n-th heading in document order. */
  const chevronOf = (root: HTMLElement, n: number): HTMLButtonElement => chevrons(root)[n]!;

  it("3.2b every heading has a chevron button that says Collapse section and is expanded", () => {
    const { root } = mountView();
    expect(headings(root)).toHaveLength(4);
    expect(chevrons(root)).toHaveLength(4);
    for (const button of chevrons(root)) {
      expect(button.getAttribute("aria-label")).toBe("Collapse section");
      expect(button.getAttribute("aria-expanded")).toBe("true");
    }
  });

  it("3.2b clicking the chevron collapses that heading's section", () => {
    const { view, root } = mountView();
    chevronOf(root, 0).click();
    expect(sorted(state(view).sections)).toEqual([TOP]);
    const [top] = headings(root);
    expect(top!.classList.contains("qmd-section-collapsed")).toBe(true);
  });

  it("3.2b clicking the chevron hides the blocks of the section but not the next section", () => {
    const { root } = mountView();
    chevronOf(root, 0).click();
    const [top, sub, deep, second] = headings(root);
    expect(sub!.classList.contains("qmd-in-collapsed-section")).toBe(true);
    expect(deep!.classList.contains("qmd-in-collapsed-section")).toBe(true);
    expect(second!.classList.contains("qmd-in-collapsed-section")).toBe(false);
    expect(second!.classList.contains("qmd-section-collapsed")).toBe(false);
    expect(top!.classList.contains("qmd-in-collapsed-section")).toBe(false);
  });

  it("3.2b a collapsed section's chevron says Expand section and is not expanded", () => {
    const { root } = mountView();
    chevronOf(root, 0).click();
    const button = chevronOf(root, 0);
    expect(button.getAttribute("aria-label")).toBe("Expand section");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(chevronOf(root, 3).getAttribute("aria-label")).toBe("Collapse section");
  });

  it("3.2b clicking the chevron of a collapsed section expands it", () => {
    const { view, root } = mountView();
    chevronOf(root, 0).click();
    chevronOf(root, 0).click();
    expect(state(view).sections.size).toBe(0);
    expect(root.querySelector(".qmd-section-collapsed")).toBeNull();
    expect(root.querySelector(".qmd-in-collapsed-section")).toBeNull();
    expect(chevronOf(root, 0).getAttribute("aria-label")).toBe("Collapse section");
  });

  it("3.2b the chevron of a nested heading toggles that heading's own section key", () => {
    const { view, root } = mountView();
    chevronOf(root, 1).click();
    expect(sorted(state(view).sections)).toEqual([SUB]);
    const [top, sub, deep] = headings(root);
    expect(sub!.classList.contains("qmd-section-collapsed")).toBe(true);
    expect(deep!.classList.contains("qmd-in-collapsed-section")).toBe(true);
    expect(top!.classList.contains("qmd-section-collapsed")).toBe(false);
  });

  it("3.2b clicking a chevron leaves the other sections' state alone", () => {
    const { view, root } = mountView();
    chevronOf(root, 3).click();
    chevronOf(root, 0).click();
    expect(sorted(state(view).sections)).toEqual([SECOND, TOP].sort());
    chevronOf(root, 0).click();
    expect(sorted(state(view).sections)).toEqual([SECOND]);
  });

  it("3.2b the chevron shows the state set by collapseAll", () => {
    const { view, root } = mountView();
    collapseAll(view);
    expect(chevronOf(root, 0).getAttribute("aria-label")).toBe("Expand section");
    expect(chevronOf(root, 3).getAttribute("aria-label")).toBe("Expand section");
    expandAll(view);
    expect(chevronOf(root, 0).getAttribute("aria-label")).toBe("Collapse section");
  });

  it("3.2b clicking the chevron changes nothing in the document", () => {
    const { view, root } = mountView();
    const before = view.state.doc;
    chevronOf(root, 0).click();
    expect(view.state.doc.eq(before)).toBe(true);
  });
});
