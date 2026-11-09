/** @jest-environment jsdom */
// Spec 7.1: Split follows the selection both ways. In a talk the editor shows only the picked slide's lines (or the preamble's): a stage pick
// selects the slide SyncTeX names and puts the cursor on its line inside the body, a panel pick focuses the slide, an included file's slide
// opens that file beside, keeping the focus, the cursor moving selects the slide under it, and the workspace's own moves are not echoed back.
// A talk's Split and Code always follow the cursor (the Sync toggle only matters to posters); Code by File shows the whole file.
// Acceptance ids: 7.1a, 7.1b, 7.1c, A7.
// These tests run Typst decks, which are off in the product.
jest.mock("../../../../src/decks/typstDecks", () => ({ TYPST_DECKS_ENABLED: true }));
import { findSourceDeckPathAt, readSourceDeckBlocks, type SourceDeckNode } from "../../../../src/decks/index.js";
import type { DeckSourceLinks, DeckWorkspaceMode } from "../../../../src/decks/dom/workspace/types";
import { flush, mount, selectedRows, type Rig } from "./workspaceHarness";

const openPdfDeck = jest.fn();
jest.mock("../../../../src/decks/dom/pdfDeck", () => ({ ...jest.requireActual("../../../../src/decks/dom/pdfDeck"), openPdfDeck: (...args: unknown[]) => openPdfDeck(...args) }));

const MAIN = [
  "% labshelf: talk", "\\documentclass{beamer}", "\\begin{document}",
  "\\begin{frame}{One}", "Hello", "\\end{frame}",
  "\\begin{frame}{Three}", "\\begin{block}{Inner}", "Text", "\\end{block}", "\\end{frame}",
  "\\input{part}",
  "\\end{document}", "",
].join("\n");
const PART = "\\begin{frame}{Two}\nMiddle\n\\end{frame}\n";
const PART_PATH = "talks/demo/part.tex";
const MAIN_TREE = readSourceDeckBlocks("latex", "talk", MAIN);
const ONE = MAIN_TREE[0]!;
const THREE = MAIN_TREE[1]!;

/** Where the next stage click lands in the source, as SyncTeX would answer it. */
let hit: { line: number; file?: string } | undefined;
const links: DeckSourceLinks = { boxes: async () => null, sourceAt: async () => hit };

beforeEach(() => {
  hit = undefined;
  openPdfDeck.mockReset();
  openPdfDeck.mockImplementation(async () => ({ count: 3, labels: null, pageSize: () => ({ width: 480, height: 270 }), render: async () => undefined, textRuns: async () => [], destroy: () => undefined }));
});

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** Longer than the workspace's cursor debounce. */
const afterDebounce = async (): Promise<void> => { await wait(200); await flush(); };

async function open(mode: DeckWorkspaceMode = "split", files = false): Promise<Rig> {
  const rig = mount("talks/demo/main.tex", MAIN, { mode, links, pdf: true, ...(files ? { files: { [PART_PATH]: PART } } : {}) });
  await flush();
  return rig;
}

async function stageClick(rig: Rig, at: { line: number; file?: string }): Promise<void> {
  hit = at;
  rig.root.querySelector<HTMLElement>(".dw-sheet")!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }));
  await flush();
}

const selectedSlide = (rig: Rig): string => selectedRows(rig, "Slides").map((row) => row.textContent ?? "").join("|");
const slideRow = (rig: Rig, title: string): HTMLElement =>
  [...rig.root.querySelectorAll<HTMLElement>('[aria-label="Slides"] [role="treeitem"]')].find((row) => row.textContent?.includes(title))!;
const syncBox = (rig: Rig): HTMLInputElement => [...rig.root.querySelectorAll<HTMLElement>(".dw-check")].find((label) => label.textContent?.includes("Sync selection"))!.querySelector("input")!;
const crumb = (rig: Rig): string => rig.root.querySelector(".dw-props-crumb")?.textContent ?? "";
const offsetIn = (node: SourceDeckNode): number => node.range[0] + 1;

describe("7.1a stage and panel -> source", () => {
  it("7.1a Sync selection is checked by default", async () => {
    const rig = await open();
    expect(syncBox(rig).checked).toBe(true);
  });

  it("7.1a a stage pick of a main-file frame shows that frame and puts the cursor at its start", async () => {
    const rig = await open();
    await stageClick(rig, { line: THREE.line });
    expect(rig.focuses.at(-1)).toEqual([ONE.range[1] + 1, MAIN.length]);
    expect(rig.reveals).toEqual([THREE.range[0]]);
    expect(rig.selects).toEqual([]);
    expect(selectedSlide(rig)).toContain("Three");
  });

  it("7.1a a stage pick on a line inside the frame's body puts the cursor on that line", async () => {
    const rig = await open();
    await stageClick(rig, { line: THREE.line + 2 });
    expect(rig.reveals).toEqual([MAIN.indexOf("Text")]);
  });

  it("7.1a the Preamble row shows the lines up to \\begin{document} and selects no slide", async () => {
    const rig = await open();
    rig.root.querySelector<HTMLElement>(".dw-preamble")!.click();
    await flush();
    expect(rig.focuses.at(-1)).toEqual([0, MAIN.indexOf("\\begin{document}") + "\\begin{document}".length]);
    expect(selectedSlide(rig)).toBe("Preamble");
    expect(rig.root.querySelector(".dw-status")?.textContent).toContain("Preamble");
  });

  it("7.1a Code still focuses the slide; File shows the whole file and Slide focuses the slide again", async () => {
    const rig = await open();
    slideRow(rig, "One").click();
    await flush();
    rig.workspace.setMode("code");
    const slideSpan = rig.focuses.at(-1);
    expect(slideSpan).not.toBeNull();
    const group = (label: string): HTMLButtonElement => rig.root.querySelector<HTMLButtonElement>(`.dw-code-bar .dw-modes[aria-label="Code"] button[aria-label="${label}"]`)!;
    group("File").click();
    expect(rig.focuses.at(-1)).toBeNull();
    expect(group("File").getAttribute("aria-pressed")).toBe("true");
    expect(group("Slide").getAttribute("aria-pressed")).toBe("false");
    group("Slide").click();
    expect(rig.focuses.at(-1)).toEqual(slideSpan);
    expect(group("Slide").getAttribute("aria-pressed")).toBe("true");
  });

  it("7.1a a cursor inside a slide's element selects the slide, never the element", async () => {
    const typst = "// labshelf: talk\n== One\n\nHello\n\n== Two\n\nLast words\n";
    const tree = readSourceDeckBlocks("typst", "talk", typst);
    const rig = mount("talks/demo/main.typ", typst, { mode: "split" });
    await flush();
    const inner = typst.indexOf("Last words") + 2;
    expect(findSourceDeckPathAt(tree, inner, (node) => node.file === undefined).length).toBeGreaterThan(1);
    rig.moveCursor(inner);
    await afterDebounce();
    expect(selectedSlide(rig)).toContain("Two");
    // The slide itself is selected: its crumb has one level, a child's would have two.
    expect(crumb(rig)).not.toContain("›");
  });

  it("7.1a a pick in the structure panel focuses the editor on that frame without selecting its text", async () => {
    const rig = await open();
    slideRow(rig, "Three").click();
    await flush();
    expect(rig.focuses.at(-1)).toEqual([ONE.range[1] + 1, MAIN.length]);
    expect(rig.cursor()).toBe(THREE.range[0]);
    expect(rig.selects).toEqual([]);
  });

  it("7.1a a newer stage click wins over a cursor move still waiting for its debounce", async () => {
    const rig = await open();
    rig.moveCursor(offsetIn(ONE));
    await stageClick(rig, { line: THREE.line });
    await afterDebounce();
    expect(selectedSlide(rig)).toContain("Three");
  });
});

describe("7.1b source -> stage", () => {
  it("7.1b moving the cursor into another frame selects it on the stage and in the panel after the debounce", async () => {
    const rig = await open();
    slideRow(rig, "One").click();
    await flush();
    rig.moveCursor(rig.cursor());
    await afterDebounce();
    rig.moveCursor(offsetIn(THREE));
    expect(selectedSlide(rig)).toContain("One");
    await afterDebounce();
    expect(selectedSlide(rig)).toContain("Three");
  });
});

describe("7.1c included files", () => {
  it("7.1c picking an included-file slide opens that file at its line without taking the focus", async () => {
    const rig = await open("split", true);
    await stageClick(rig, { line: 1, file: PART_PATH });
    expect(rig.opens).toEqual([[PART_PATH, 1, { preserveFocus: true }]]);
    expect(rig.selects).toEqual([]);
    expect(selectedSlide(rig)).toContain("Two");
  });

  it("7.1c a cursor in the included file selects the slide under it, and never opens or selects back", async () => {
    const rig = await open("split", true);
    slideRow(rig, "One").click();
    await flush();
    const selects = rig.selects.length;
    expect(rig.fileCursor(PART_PATH, 2)).toBe(true);
    await flush();
    expect(selectedSlide(rig)).toContain("Two");
    expect(rig.opens).toEqual([]);
    expect(rig.selects).toHaveLength(selects);
    expect(rig.reveals).toEqual([]);
  });

  it("7.1c a cursor in another file, or outside any slide, selects nothing", async () => {
    const rig = await open("split", true);
    slideRow(rig, "One").click();
    await flush();
    rig.fileCursor("talks/demo/other.tex", 2);
    rig.fileCursor(PART_PATH, 40);
    await flush();
    expect(selectedSlide(rig)).toContain("One");
  });

  it("7.1c dispose stops listening to the file cursor", async () => {
    const rig = await open("split", true);
    expect(rig.fileCursorSubscribed()).toBe(true);
    rig.workspace.dispose();
    expect(rig.fileCursorSubscribed()).toBe(false);
  });
});
