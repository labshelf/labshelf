/** @jest-environment jsdom */
// Spec 10b.2: the compiled poster controls in the LaTeX workspace: the Poster button with Poster Settings in place of the properties, and the overflow
// badges, outlines and the status after an orientation switch; and a poster's code by block: the block strip, the focus on a block, page picks and the
// hover outline. SyncTeX is faked through the links port: each block of the a1-tikz poster has a box, so the stage places the blocks. The fit scale is made 1 (the scroller measures 1032 x 732 for a 1000 x 700 page),
// so a pointer at (x, y) is the page point (x, y). Edits are compared with the 10b.1 functions' output. Acceptance ids: 10b.2c, 10b.2d, A10, poster code.
import {
  readSourceDeckBlocks, setSourcePosterSpacing, sourceDeckSpans, sourceDeckUnits, switchSourcePosterOrientation, type SourceDeckNode,
} from "../../../../src/decks/index";
import type { DeckBuildState, DeckSourceLinks } from "../../../../src/decks/dom/workspace/types";
import { TIKZ, button, flush, mount, selectedRows, type Rig } from "./workspaceHarness";

const openPdfDeck = jest.fn();
jest.mock("../../../../src/decks/dom/pdfDeck", () => ({ ...jest.requireActual("../../../../src/decks/dom/pdfDeck"), openPdfDeck: (...args: unknown[]) => openPdfDeck(...args) }));

const PATH = "posters/demo/main.tex";
const columnsOf = (text: string): SourceDeckNode[] => readSourceDeckBlocks("latex", "poster", text).filter((node) => node.kind === "column");
const BLOCKS = columnsOf(TIKZ).map((column) => (column.children ?? []).filter((node) => node.kind === "block"));
/** Page rects (pt) of the blocks "column.index": two columns of two blocks, block centres at y 150 and 300. */
const RECTS: Record<string, [number, number, number, number]> = { "0.0": [100, 100, 400, 200], "0.1": [100, 250, 400, 350], "1.0": [500, 100, 800, 200], "1.1": [500, 250, 800, 350] };

function linksFor(text: string, rects: Record<string, [number, number, number, number]> = RECTS): DeckSourceLinks {
  const blocks = columnsOf(text).map((column) => (column.children ?? []).filter((node) => node.kind === "block"));
  return {
    boxes: async (from, to, file) => {
      if (file !== undefined) return null;
      for (const [c, column] of blocks.entries()) for (const [b, node] of column.entries()) {
        const rect = rects[`${c}.${b}`];
        if (rect && node.line === from && node.endLine === to) return [{ page: 1, left: rect[0], top: rect[1], right: rect[2], bottom: rect[3] }];
      }
      return null;
    },
    sourceAt: async () => undefined,
  };
}

beforeEach(() => {
  openPdfDeck.mockReset();
  openPdfDeck.mockImplementation(async () => ({ count: 1, labels: null, pageSize: () => ({ width: 1000, height: 700 }), render: async () => undefined, textRuns: async () => [], destroy: () => undefined }));
  jest.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(1032);
  jest.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(732);
});
afterEach(() => { jest.restoreAllMocks(); });

const settle = async (): Promise<void> => { await flush(); await flush(); await flush(); };
const OK: DeckBuildState = { state: "succeeded", errors: 0 };

async function open(text = TIKZ, rects: Record<string, [number, number, number, number]> = RECTS): Promise<Rig> {
  const rig = mount(PATH, text, { links: linksFor(text, rects), pdf: true });
  await settle();
  rig.emitBuild(OK);
  await settle();
  return rig;
}


const NOTE = "Header height follows the template in LaTeX and Typst.";
const posterButton = (rig: Rig): HTMLButtonElement => button(rig.root, "Poster");
const styleButton = (rig: Rig): HTMLButtonElement => button(rig.root, "Style");
const note = (rig: Rig): HTMLElement | undefined => [...rig.root.querySelectorAll<HTMLElement>("*")].find((el) => el.children.length === 0 && el.textContent === NOTE);
const settingsOpen = (rig: Rig): boolean => { const el = note(rig); return el !== undefined && el.closest("[hidden]") === null; };
const styleOpen = (rig: Rig): boolean => rig.root.querySelector("aside[aria-label=Style]") !== null;
const props = (rig: Rig): HTMLElement => rig.root.querySelector<HTMLElement>(".dw-props:not(.dsh-style)")!;
const fieldInput = (rig: Rig, label: string): HTMLInputElement => {
  const labelled = [...rig.root.querySelectorAll<HTMLElement>("label")].find((el) => (el.textContent ?? "").trim().startsWith(label));
  return (labelled?.querySelector("input") ?? rig.root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`))!;
};
const change = (input: HTMLInputElement, value: string): void => { input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); };
const orientation = (rig: Rig, name: "Portrait" | "Landscape"): HTMLButtonElement => button(rig.root, name);

describe("10b.2c the Poster button and Poster Settings", () => {
  it("10b.2c a poster has a Poster button, a talk has none", async () => {
    const rig = await open();
    expect(posterButton(rig)).not.toBeNull();
    const talk = mount("talks/demo/main.tex", "% labshelf: talk\n\\documentclass{beamer}\n\\begin{document}\n\\begin{frame}{One}\nHi\n\\end{frame}\n\\end{document}\n");
    expect(button(talk.root, "Poster")).toBeNull();
  });

  it("10b.2c the button shows the panel in place of the properties and a second click brings the properties back", async () => {
    const rig = await open();
    expect(settingsOpen(rig)).toBe(false);
    posterButton(rig).click();
    expect(settingsOpen(rig)).toBe(true);
    expect(props(rig).hidden).toBe(true);
    expect(posterButton(rig).getAttribute("aria-pressed")).toBe("true");
    posterButton(rig).click();
    expect(settingsOpen(rig)).toBe(false);
    expect(props(rig).hidden).toBe(false);
    expect(posterButton(rig).getAttribute("aria-pressed")).toBe("false");
  });

  it("10b.2c the panel shows the margin and gap in cm and no header height field", async () => {
    const rig = await open();
    posterButton(rig).click();
    expect(fieldInput(rig, "Outer margin").value).toBe("0");
    expect(fieldInput(rig, "Section gap").value).toBe("1.5");
    expect(rig.root.textContent).not.toMatch(/Header height(?! follows)/);
  });

  it("10b.2c the orientation toggle shows landscape for a1-tikz and writes switchSourcePosterOrientation's edit once", async () => {
    const rig = await open();
    posterButton(rig).click();
    expect(orientation(rig, "Landscape").getAttribute("aria-pressed")).toBe("true");
    orientation(rig, "Portrait").click();
    await settle();
    expect(rig.applied).toEqual([switchSourcePosterOrientation("latex", TIKZ)!.text]);
  });

  it("10b.2c a changed Outer margin writes setSourcePosterSpacing's edit once", async () => {
    const rig = await open();
    posterButton(rig).click();
    change(fieldInput(rig, "Outer margin"), "2");
    await settle();
    expect(rig.applied).toEqual([setSourcePosterSpacing("latex", TIKZ, { margin: 20 })!.text]);
  });

  it("10b.2c a changed Section gap writes setSourcePosterSpacing's edit once", async () => {
    const rig = await open();
    posterButton(rig).click();
    change(fieldInput(rig, "Section gap"), "2.5");
    await settle();
    expect(rig.applied).toEqual([setSourcePosterSpacing("latex", TIKZ, { gap: 25 })!.text]);
  });

  it("10b.2c Style and Poster are exclusive: opening one closes the other", async () => {
    const rig = await open();
    posterButton(rig).click();
    styleButton(rig).click();
    expect(styleOpen(rig)).toBe(true);
    expect(settingsOpen(rig)).toBe(false);
    expect(posterButton(rig).getAttribute("aria-pressed")).toBe("false");
    posterButton(rig).click();
    expect(settingsOpen(rig)).toBe(true);
    expect(styleOpen(rig)).toBe(false);
    expect(styleButton(rig).getAttribute("aria-pressed")).toBe("false");
    expect(props(rig).hidden).toBe(true);
  });
});

const cards = (rig: Rig): HTMLElement[] => [...rig.root.querySelectorAll<HTMLElement>('[aria-label="Blocks"] .dw-block-card')];
const methodRow = (rig: Rig): HTMLElement => cards(rig)[1]!;
const introRow = (rig: Rig): HTMLElement => cards(rig)[0]!;
const overflowing = (line: number): DeckBuildState => ({ state: "succeeded", errors: 0, overflow: [{ file: PATH, line }] });
const building: DeckBuildState = { state: "building", errors: 0 };
const statusText = (rig: Rig): string => rig.root.querySelector(".dw-status")!.textContent ?? "";
const WARNING = "Some blocks overflow after the orientation change";

describe("10b.2d overflow", () => {
  it("10b.2d a block row whose lines hold an Overfull vbox mark gets the overflow badge, the others none", async () => {
    const rig = await open();
    rig.emitBuild(building);
    rig.emitBuild(overflowing(BLOCKS[0]![1]!.line + 1));
    await settle();
    const badge = methodRow(rig).querySelector<HTMLElement>(".dsh-overflow-badge");
    expect(badge).not.toBeNull();
    expect(badge!.title).toBe("Content overflows this block");
    expect(introRow(rig).querySelector(".dsh-overflow-badge")).toBeNull();
  });

  it("10b.2d the stage outlines the overflowing block with an is-overflow outline", async () => {
    const rig = await open();
    expect(rig.root.querySelectorAll(".dw-outline.is-overflow")).toHaveLength(0);
    rig.emitBuild(building);
    rig.emitBuild(overflowing(BLOCKS[0]![1]!.line + 1));
    await settle();
    expect(rig.root.querySelectorAll(".dw-outline.is-overflow")).toHaveLength(1);
  });

  it("10b.2d a later build without marks clears the badge and the outline", async () => {
    const rig = await open();
    rig.emitBuild(building);
    rig.emitBuild(overflowing(BLOCKS[0]![1]!.line + 1));
    await settle();
    rig.emitBuild(building);
    rig.emitBuild(OK);
    await settle();
    expect(rig.root.querySelector(".dsh-overflow-badge")).toBeNull();
    expect(rig.root.querySelectorAll(".dw-outline.is-overflow")).toHaveLength(0);
  });

  it("10b.2d after an orientation switch the next build with overflow puts the warning in the status bar", async () => {
    const rig = await open();
    posterButton(rig).click();
    orientation(rig, "Portrait").click();
    await settle();
    expect(statusText(rig)).not.toContain(WARNING);
    rig.emitBuild(building);
    rig.emitBuild(overflowing(BLOCKS[0]![1]!.line + 1));
    await settle();
    expect(statusText(rig)).toContain(WARNING);
  });

  it("10b.2d a build with overflow that follows no orientation switch shows no warning", async () => {
    const rig = await open();
    rig.emitBuild(building);
    rig.emitBuild(overflowing(BLOCKS[0]![1]!.line + 1));
    await settle();
    expect(statusText(rig)).not.toContain(WARNING);
  });

  it("10b.2d after an orientation switch a build without overflow shows no warning", async () => {
    const rig = await open();
    posterButton(rig).click();
    orientation(rig, "Portrait").click();
    await settle();
    rig.emitBuild(building);
    rig.emitBuild(OK);
    await settle();
    expect(statusText(rig)).not.toContain(WARNING);
  });
});

describe("A10 compiled half (UI)", () => {
  it("A10 Poster Settings switches orientation and then warns when the next build overflows", async () => {
    const rig = await open();
    posterButton(rig).click();
    orientation(rig, "Portrait").click();
    change(fieldInput(rig, "Outer margin"), "2");
    await settle();
    expect(rig.applied).toHaveLength(2);
    rig.emitBuild(building);
    rig.emitBuild(overflowing(BLOCKS[0]![1]!.line + 1));
    await settle();
    expect(statusText(rig)).toContain(WARNING);
    expect(methodRow(rig).querySelector(".dsh-overflow-badge")).not.toBeNull();
  });
});

describe("a poster's code by block", () => {
  const units = sourceDeckUnits("poster", readSourceDeckBlocks("latex", "poster", TIKZ));
  const spans = sourceDeckSpans("latex", TIKZ, units)!;
  const sheet = (rig: Rig): HTMLElement => rig.root.querySelector<HTMLElement>(".dw-sheet")!;
  const at = (type: string, rig: Rig, x: number, y: number): void => void sheet(rig).dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  const viewButton = (rig: Rig, label: string): HTMLButtonElement => rig.root.querySelector<HTMLButtonElement>(`.dw-pane-bar button[aria-label="${label}"]`)!;

  it("the block list (hidden, not under the page) holds Preamble, one card per block with its column's number, then New block; no Overview", async () => {
    const rig = await open();
    const list = rig.root.querySelector<HTMLElement>('[aria-label="Blocks"]')!;
    expect(list.firstElementChild!.classList.contains("dw-preamble")).toBe(true);
    expect(cards(rig)).toHaveLength(units.length);
    expect(cards(rig).map((card) => card.querySelector(".dw-thumb-number")!.textContent)).toEqual(BLOCKS.flatMap((column, c) => column.map(() => String(c + 1))));
    expect(rig.root.querySelector(".dw-structure > .dw-new-slide")!.textContent).toBe("New block");
    expect(rig.root.querySelector(".dw-overview")).toBeNull();
    // A poster shows no strip under its page (CSS hides the panel): it stays out of the preview's window.
    expect(rig.root.querySelector(".dw-stage-column > .dw-structure")).toBeNull();
  });

  it("opens on the first block: the editor shows only its span, and a card pick focuses that block", async () => {
    const rig = await open();
    expect(rig.focuses.at(-1)).toEqual(spans.units[0]!.range);
    expect(selectedRows(rig, "Blocks")).toEqual([cards(rig)[0]]);
    cards(rig)[2]!.click();
    expect(rig.focuses.at(-1)).toEqual(spans.units[2]!.range);
    expect(rig.cursor()).toBe(units[2]!.node.range[0]);
  });

  it("the Preamble card focuses the preamble's lines; File shows the whole file and moves the cursor to a picked block", async () => {
    const rig = await open();
    rig.root.querySelector<HTMLElement>('[aria-label="Blocks"] .dw-preamble')!.click();
    expect(rig.focuses.at(-1)).toEqual(spans.preamble);
    expect(TIKZ.slice(...spans.preamble)).toMatch(/\\begin\{document\}$/);
    viewButton(rig, "File").click();
    expect(rig.focuses.at(-1)).toBeNull();
    cards(rig)[3]!.click();
    expect(rig.focuses.at(-1)).toBeNull();
    expect(rig.cursor()).toBe(units[3]!.node.range[0]);
  });

  it("a cursor moved into another block's span selects that block", async () => {
    const rig = await open();
    rig.moveCursor(units[1]!.node.range[0] + 1);
    await wait(200);
    expect(selectedRows(rig, "Blocks")).toEqual([cards(rig)[1]]);
    expect(rig.focuses.at(-1)).toEqual(spans.units[1]!.range);
  });

  it("a click on the page selects the block under it and reveals its start; a click outside every block does nothing", async () => {
    const rig = await open();
    at("click", rig, 600, 300);
    await settle();
    expect(selectedRows(rig, "Blocks")).toEqual([cards(rig)[3]]);
    expect(rig.reveals.at(-1)).toBe(units[3]!.node.range[0]);
    at("click", rig, 950, 650);
    await settle();
    expect(selectedRows(rig, "Blocks")).toEqual([cards(rig)[3]]);
  });

  it("the block under the pointer gets the hover outline, the selected one keeps its outline, and leaving clears it", async () => {
    const rig = await open();
    const hovered = (): number => rig.root.querySelectorAll(".dw-outline-hover").length;
    at("pointermove", rig, 600, 150);
    await wait(100);
    await settle();
    expect(hovered()).toBe(1);
    expect(rig.root.querySelectorAll(".dw-outline-selected")).toHaveLength(1);
    sheet(rig).dispatchEvent(new MouseEvent("pointerleave"));
    await settle();
    expect(hovered()).toBe(0);
  });

  it("shows no linking note over the page", async () => {
    const rig = await open();
    expect(rig.root.querySelector<HTMLElement>(".dw-stage-note")!.hidden).toBe(true);
  });
});
