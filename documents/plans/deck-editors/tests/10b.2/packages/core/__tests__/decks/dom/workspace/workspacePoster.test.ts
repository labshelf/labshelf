/** @jest-environment jsdom */
// Spec 10b.2: the compiled poster controls in the LaTeX workspace: block drag on a fresh build, gap handles, the Poster button with Poster Settings in
// place of the properties, and the overflow badges, outlines and the status after an orientation switch. SyncTeX is faked through the links port: each
// block of the a1-tikz poster has a box, so the stage knows the columns. The fit scale is made 1 (the scroller measures 1032 x 732 for a 1000 x 700 page),
// so a pointer at (x, y) is the page point (x, y). Edits are compared with the 10b.1 functions' output. Acceptance ids: 10b.2a, 10b.2b, 10b.2c, 10b.2d, A10.
import {
  readSourceDeckBlocks, moveSourcePosterBlock, resizeSourcePosterGap, setSourcePosterSpacing, switchSourcePosterOrientation,
  type SourceDeckNode,
} from "../../../../src/decks/index";
import type { DeckBuildState, DeckSourceLinks } from "../../../../src/decks/dom/workspace/types";
import { TIKZ, button, flush, mount, selectedRows, type Rig } from "./workspaceHarness";

const openPdfDeck = jest.fn();
jest.mock("../../../../src/decks/dom/pdfDeck", () => ({ ...jest.requireActual("../../../../src/decks/dom/pdfDeck"), openPdfDeck: (...args: unknown[]) => openPdfDeck(...args) }));

const PATH = "posters/demo/main.tex";
const NOTE = "Header height follows the template in LaTeX and Typst.";
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

const visible = (el: Element | null): boolean => el !== null && el.closest("[hidden]") === null && (el as HTMLElement).style.display !== "none" && (el as HTMLElement).style.visibility !== "hidden";
const gaps = (rig: Rig): HTMLElement[] => [...rig.root.querySelectorAll<HTMLElement>(".dsh-poster-gap")].filter((el) => visible(el));
const dropVisible = (rig: Rig): boolean => visible(rig.root.querySelector(".dsh-poster-drop"));
const px = (value: string): number => parseFloat(value);
const fire = (type: string, target: Element, x: number, y: number): void => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1 }));

/** What a press at (x, y) hits inside the sheet: the smallest hit area with its own px geometry under the stage's layer (not the outlines or the page), else the stage's first layer. */
function targetAt(rig: Rig, x: number, y: number): Element {
  const sheet = rig.root.querySelector<HTMLElement>(".dw-sheet")!;
  let best: { el: Element; area: number } | undefined;
  for (const el of sheet.querySelectorAll<HTMLElement>("*")) {
    if (el.closest(".dw-overlay") || el.tagName === "CANVAS" || el.classList.contains("dsh-poster-drop") || el.getAttribute("role") === "separator") continue;
    const [left, top, width, height] = [px(el.style.left), px(el.style.top), px(el.style.width), px(el.style.height)];
    if (![left, top, width, height].every(Number.isFinite)) continue;
    if (x >= left && x <= left + width && y >= top && y <= top + height && (!best || width * height < best.area)) best = { el, area: width * height };
  }
  return best?.el ?? [...sheet.children].find((el) => el.tagName !== "CANVAS" && !el.classList.contains("dw-overlay") && !el.classList.contains("dsh-poster-drop")) ?? sheet;
}
function drag(rig: Rig, from: { x: number; y: number }, to: { x: number; y: number }, release = true): void {
  const target = targetAt(rig, from.x, from.y);
  fire("pointerdown", target, from.x, from.y);
  fire("pointermove", target, from.x + 6, from.y + 6);
  fire("pointermove", target, to.x, to.y);
  if (release) fire("pointerup", target, to.x, to.y);
}
const escape = (): void => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

describe("10b.2a dragging a block on a fresh build", () => {
  it("10b.2a releasing block Introduction over the top of the second column writes one edit, moveSourcePosterBlock's", async () => {
    const rig = await open();
    drag(rig, { x: 250, y: 150 }, { x: 650, y: 120 });
    await settle();
    const expected = moveSourcePosterBlock("latex", TIKZ, { column: 0, index: 0 }, { column: 1, index: 0 })!;
    expect(rig.applied).toEqual([expected.text]);
    expect(rig.text()).toBe(expected.text);
  });

  it("10b.2a a block dragged up inside its column is written as a move within the column", async () => {
    const rig = await open();
    drag(rig, { x: 250, y: 300 }, { x: 250, y: 110 });
    await settle();
    expect(rig.applied).toEqual([moveSourcePosterBlock("latex", TIKZ, { column: 0, index: 1 }, { column: 0, index: 0 })!.text]);
  });

  it("10b.2a the drop bar shows during the drag and is gone after the release", async () => {
    const rig = await open();
    expect(dropVisible(rig)).toBe(false);
    drag(rig, { x: 250, y: 150 }, { x: 650, y: 120 }, false);
    expect(dropVisible(rig)).toBe(true);
    expect(rig.applied).toEqual([]);
    fire("pointerup", targetAt(rig, 250, 150), 650, 120);
    await settle();
    expect(dropVisible(rig)).toBe(false);
  });

  it("10b.2a Escape during the drag writes nothing", async () => {
    const rig = await open();
    drag(rig, { x: 250, y: 150 }, { x: 650, y: 120 }, false);
    escape();
    fire("pointerup", targetAt(rig, 250, 150), 650, 120);
    await settle();
    expect(rig.applied).toEqual([]);
    expect(rig.text()).toBe(TIKZ);
    expect(dropVisible(rig)).toBe(false);
  });

  it("10b.2a a release on the block's own place writes nothing", async () => {
    const rig = await open();
    drag(rig, { x: 250, y: 150 }, { x: 250, y: 160 });
    await settle();
    expect(rig.applied).toEqual([]);
  });

  it("10b.2a a short click on a block still selects it and writes nothing", async () => {
    const rig = await open();
    expect(selectedRows(rig, "Blocks").map((row) => row.textContent).join("|")).not.toContain("Conclusion");
    const target = targetAt(rig, 650, 300);
    fire("pointerdown", target, 650, 300);
    fire("pointerup", target, 651, 300);
    rig.root.querySelector<HTMLElement>(".dw-sheet")!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 651, clientY: 300 }));
    await settle();
    expect(selectedRows(rig, "Blocks").map((row) => row.textContent).join("|")).toContain("Conclusion");
    expect(rig.applied).toEqual([]);
  });

  it("10b.2a no drag is offered while the build runs or after it failed, and it is offered again after the next good build", async () => {
    const rig = await open();
    for (const state of ["building", "failed"] as const) {
      rig.emitBuild({ state, errors: state === "failed" ? 1 : 0 });
      await settle();
      drag(rig, { x: 250, y: 150 }, { x: 650, y: 120 });
      await settle();
      expect(rig.applied).toEqual([]);
    }
    rig.emitBuild({ state: "building", errors: 0 });
    rig.emitBuild(OK);
    await settle();
    drag(rig, { x: 250, y: 150 }, { x: 650, y: 120 });
    await settle();
    expect(rig.applied).toHaveLength(1);
  });

  it("10b.2a disposing the workspace during a drag removes its window listeners: a release afterwards writes nothing", async () => {
    const rig = await open();
    drag(rig, { x: 250, y: 150 }, { x: 650, y: 120 }, false);
    rig.workspace.dispose();
    fire("pointermove", document.body, 650, 110);
    fire("pointerup", document.body, 650, 110);
    await settle();
    expect(rig.applied).toEqual([]);
  });
});

describe("10b.2b the gap handle", () => {
  it("10b.2b shows one separator handle between the two columns of a poster with ratios", async () => {
    const rig = await open();
    expect(gaps(rig)).toHaveLength(1);
    expect(gaps(rig)[0]!.getAttribute("role")).toBe("separator");
    expect(gaps(rig)[0]!.getAttribute("aria-orientation")).toBe("vertical");
  });

  it("10b.2b dragging the handle writes nothing until the release, then one resizeSourcePosterGap edit with the travel in mm", async () => {
    const rig = await open();
    const handle = gaps(rig)[0]!;
    fire("pointerdown", handle, 450, 200);
    fire("pointermove", handle, 470, 200);
    fire("pointermove", handle, 486, 200);
    expect(rig.applied).toEqual([]);
    fire("pointerup", handle, 486, 200);
    await settle();
    const expected = resizeSourcePosterGap("latex", TIKZ, 0, (36 * 25.4) / 72)!;
    expect(rig.applied).toEqual([expected.text]);
  });

  it("10b.2b Escape during the handle drag writes nothing", async () => {
    const rig = await open();
    const handle = gaps(rig)[0]!;
    fire("pointerdown", handle, 450, 200);
    fire("pointermove", handle, 470, 200);
    escape();
    fire("pointerup", handle, 470, 200);
    await settle();
    expect(rig.applied).toEqual([]);
  });

  it("10b.2b shows no handle while the build runs or after it failed", async () => {
    const rig = await open();
    rig.emitBuild({ state: "building", errors: 0 });
    await settle();
    expect(gaps(rig)).toHaveLength(0);
    rig.emitBuild({ state: "failed", errors: 1 });
    await settle();
    expect(gaps(rig)).toHaveLength(0);
    rig.emitBuild({ state: "building", errors: 0 });
    rig.emitBuild(OK);
    await settle();
    expect(gaps(rig)).toHaveLength(1);
  });

  it("10b.2b shows no handle for a poster whose columns have no readable ratios", async () => {
    const NO_RATIOS = TIKZ.replace(/\\column\{0\.5\}/g, "\\column{8cm}");
    const rig = await open(NO_RATIOS);
    expect(gaps(rig)).toHaveLength(0);
  });
});

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

const methodRow = (rig: Rig): HTMLElement => [...rig.root.querySelectorAll<HTMLElement>('[aria-label="Blocks"] [data-kind="block"]')].find((row) => row.title === `Line ${BLOCKS[0]![1]!.line}`)!;
const introRow = (rig: Rig): HTMLElement => [...rig.root.querySelectorAll<HTMLElement>('[aria-label="Blocks"] [data-kind="block"]')].find((row) => row.title === `Line ${BLOCKS[0]![0]!.line}`)!;
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
  it("A10 a block dragged across columns reorders the source as one undo step, on release", async () => {
    const rig = await open();
    drag(rig, { x: 250, y: 300 }, { x: 650, y: 120 }, false);
    expect(rig.applied).toEqual([]);
    fire("pointerup", targetAt(rig, 250, 300), 650, 120);
    await settle();
    expect(rig.applied).toHaveLength(1);
    const moved = columnsOf(rig.text()).map((column) => (column.children ?? []).filter((node) => node.kind === "block").length);
    expect(moved).toEqual([1, 3]);
  });

  it("A10 a gap dragged to the right widens the first column and the written fractions still sum to 1", async () => {
    const rig = await open();
    const handle = gaps(rig)[0]!;
    fire("pointerdown", handle, 450, 200);
    fire("pointermove", handle, 470, 200);
    fire("pointermove", handle, 486, 200);
    fire("pointerup", handle, 486, 200);
    await settle();
    expect(rig.applied).toHaveLength(1);
    const fractions = [...rig.text().matchAll(/\\column\{([\d.]+)\}/g)].map((m) => Number(m[1]));
    expect(fractions).toHaveLength(2);
    expect(fractions[0]!).toBeGreaterThan(0.5);
    expect(Math.round((fractions[0]! + fractions[1]!) * 100) / 100).toBe(1);
  });

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
