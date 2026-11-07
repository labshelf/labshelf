/** @jest-environment jsdom */
// Spec 7.1: Split follows the selection both ways. A stage or panel pick selects the node's range in the editor (an included file's node opens
// that file beside, keeping the focus), the cursor moving selects the node under it, and the workspace's own select is not echoed back.
// Acceptance ids: 7.1a, 7.1b, 7.1c, A7.
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

  it("7.1a a stage pick of a main-file frame selects its range in the editor", async () => {
    const rig = await open();
    await stageClick(rig, { line: THREE.line });
    expect(rig.selects).toEqual([[THREE.range[0], THREE.range[1]]]);
    expect(rig.reveals).toEqual([]);
    expect(selectedSlide(rig)).toContain("Three");
  });

  it("7.1a the cursor event echoing the workspace's own select keeps the picked slide selected, not its child", async () => {
    // A Typst slide ends where its last child ends: the cursor a select leaves at the slide's end is inside that child.
    const typst = "// labshelf: talk\n== One\n\nHello\n\n== Two\n\nLast words\n";
    const tree = readSourceDeckBlocks("typst", "talk", typst);
    const rig = mount("talks/demo/main.typ", typst, { mode: "split" });
    await flush();
    slideRow(rig, "Two").click();
    await flush();
    const two = tree[1]!;
    expect(rig.selects).toEqual([[two.range[0], two.range[1]]]);
    const echoed = findSourceDeckPathAt(tree, rig.cursor(), (node) => node.file === undefined);
    expect(echoed.length).toBeGreaterThan(1);
    rig.moveCursor(rig.cursor());
    await afterDebounce();
    expect(selectedSlide(rig)).toContain("Two");
    // The slide itself is selected: its crumb has one level, a child's would have two.
    expect(crumb(rig)).not.toContain("›");
    // The next move of the user's is followed again.
    rig.moveCursor(rig.cursor());
    await afterDebounce();
    expect(crumb(rig)).toContain("›");
  });

  it("7.1a a pick in the structure panel selects the frame's range too", async () => {
    const rig = await open();
    slideRow(rig, "One").click();
    await flush();
    expect(rig.selects).toEqual([[ONE.range[0], ONE.range[1]]]);
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

  it("7.1b with Sync selection unchecked nothing follows either way", async () => {
    const rig = await open();
    const box = syncBox(rig);
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    slideRow(rig, "One").click();
    await stageClick(rig, { line: THREE.line });
    expect(rig.selects).toEqual([]);
    expect(rig.reveals).toEqual([]);
    expect(selectedSlide(rig)).toContain("Three");
    rig.moveCursor(offsetIn(ONE));
    await afterDebounce();
    expect(selectedSlide(rig)).toContain("Three");
  });

  it("7.1b in Visual nothing follows", async () => {
    const rig = await open("visual");
    slideRow(rig, "One").click();
    await stageClick(rig, { line: THREE.line });
    expect(rig.selects).toEqual([]);
    expect(rig.reveals).toEqual([]);
    rig.moveCursor(offsetIn(ONE));
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

  it("7.1c in Visual a cursor in the included file selects nothing", async () => {
    const rig = await open("visual", true);
    slideRow(rig, "One").click();
    rig.fileCursor(PART_PATH, 2);
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
