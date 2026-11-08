/** @jest-environment jsdom */
// Spec 6.2: the Grid mode of compiled talks in the workspace: the tab for talks only, one cell per slide, reorder through moveSourceDeckNodeTo,
// the cell menu (duplicate, delete, arrange) each as one apply(), the shell's Delete and Mod+D on the selected slide, and double-click to Visual.
// Acceptance ids: 6.2a, 6.2b, 6.2c, 6.2d, A7.
import { closeMenu } from "../../../../src/ui/dom/index.js";
import { createShellHeader } from "../../../../src/decks/dom/shell/index.js";
import {
  SLIDE_ARRANGEMENTS, arrangeSourceSlide, deleteSourceDeckNode, duplicateSourceDeckNode, moveSourceDeckNodeTo, readSourceDeckBlocks,
} from "../../../../src/decks/index.js";
import { BEAMER, flush, mod, poster, press, statusLeft, talk, type Rig } from "./workspaceHarness";

afterEach(() => closeMenu());

const tree = readSourceDeckBlocks("latex", "talk", BEAMER);
const slides = tree.filter((n) => n.kind === "slide");
const slideAt = (cell: number): number => tree.indexOf(slides[cell]!);

const tabs = (rig: Rig): string[] => [...rig.root.querySelectorAll<HTMLElement>('.dw-header [role="tab"]')].map((tab) => tab.getAttribute("aria-label") ?? "");
const cells = (rig: Rig): HTMLElement[] => [...rig.root.querySelectorAll<HTMLElement>('[role="listbox"][aria-label="Slide grid"] [role="option"]')];
const fire = (el: Element, type: string, init: MouseEventInit = {}): void => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init })); };
const menuItem = (label: string): HTMLButtonElement => [...document.querySelectorAll<HTMLButtonElement>(".ls-menu .ls-menu-item")].find((item) => item.textContent?.trim() === label)!;
const cellMenu = (rig: Rig, cell: number): void => fire(rig.root.querySelectorAll('.dsh-grid button[aria-label="Slide actions"]')[cell]!, "click");

async function gridTalk(): Promise<Rig> {
  const rig = talk({ mode: "grid" });
  await flush();
  return rig;
}

describe("the Grid mode", () => {
  it("6.2a a talk has a Grid tab; a poster and the HTML shell do not", async () => {
    const rig = talk();
    const latexPoster = poster();
    await flush();
    expect(tabs(rig)).toEqual(["Visual", "Split", "Code", "Grid"]);
    expect(tabs(latexPoster)).not.toContain("Grid");
    expect(latexPoster.root.querySelector(".dsh-grid")).toBeNull();
    const htmlHeader = createShellHeader({ title: "Deck", badge: "HTML", modes: ["visual", "code"] });
    expect(htmlHeader.element.querySelector('[aria-label="Grid"]')).toBeNull();
  });

  it("6.2a a poster whose saved mode is grid opens in Visual", async () => {
    const latexPoster = poster({ mode: "grid" });
    await flush();
    expect(latexPoster.workspace.mode()).toBe("visual");
    expect(latexPoster.root.dataset["mode"]).toBe("visual");
  });

  it("6.2a a beamer talk in grid mode lists one cell per slide with its title", async () => {
    const rig = await gridTalk();
    expect(rig.root.dataset["mode"]).toBe("grid");
    expect(cells(rig)).toHaveLength(slides.length);
    expect(slides.length).toBeGreaterThan(2);
    for (const cell of cells(rig)) expect(cell.querySelector(".dsh-grid-title")!.textContent).not.toBe("");
  });

  it("6.2a the Grid tab switches a talk to grid mode and keeps it in the mode port", async () => {
    const rig = talk();
    await flush();
    fire(rig.root.querySelector('.dw-header [role="tab"][aria-label="Grid"]')!, "click");
    expect(rig.workspace.mode()).toBe("grid");
    expect(rig.modes.at(-1)).toBe("grid");
  });
});

describe("grid reorder", () => {
  it("6.2b dragging cell 1 after cell 3 applies moveSourceDeckNodeTo's change once", async () => {
    const rig = await gridTalk();
    const target = cells(rig)[2]!.closest<HTMLElement>(".dsh-grid-cell")!;
    target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 60, right: 100, bottom: 60, x: 0, y: 0, toJSON: () => ({}) });
    fire(cells(rig)[0]!, "dragstart");
    fire(cells(rig)[2]!, "drop", { clientX: 90 });
    expect(rig.applied).toEqual([moveSourceDeckNodeTo(BEAMER, slides, 0, 2)!.text]);
  });

  it("6.2b Alt+ArrowRight on the first cell applies moveSourceDeckNodeTo's change once", async () => {
    const rig = await gridTalk();
    press(cells(rig)[0]!, "ArrowRight", { altKey: true });
    expect(rig.applied).toEqual([moveSourceDeckNodeTo(BEAMER, slides, 0, 1)!.text]);
  });
});

describe("grid cell menu", () => {
  it("6.2c Duplicate applies duplicateSourceDeckNode's text as one change", async () => {
    const rig = await gridTalk();
    cellMenu(rig, 1);
    fire(menuItem("Duplicate"), "click");
    expect(rig.applied).toEqual([duplicateSourceDeckNode(BEAMER, slides[1]!)!.text]);
  });

  it("6.2c Delete applies deleteSourceDeckNode's text as one change", async () => {
    const rig = await gridTalk();
    cellMenu(rig, 2);
    fire(menuItem("Delete"), "click");
    expect(rig.applied).toEqual([deleteSourceDeckNode(BEAMER, slides[2]!)!.text]);
  });

  it("6.2c A7 Arrange as two columns applies arrangeSourceSlide's text as one change, keeping the content", async () => {
    const rig = await gridTalk();
    const cell = slides.findIndex((slide) => arrangeSourceSlide("latex", BEAMER, slide, "two-columns") !== null);
    expect(cell).toBeGreaterThanOrEqual(0);
    cellMenu(rig, cell);
    fire(menuItem("Arrange"), "click");
    fire(menuItem(SLIDE_ARRANGEMENTS.find((a) => a.id === "two-columns")!.label), "click");
    expect(rig.applied).toEqual([arrangeSourceSlide("latex", BEAMER, slides[cell]!, "two-columns")!.text]);
  });

  it("6.2c an arrangement that cannot be written applies nothing and flashes the message", async () => {
    const rig = await gridTalk();
    const cell = slides.findIndex((slide) => arrangeSourceSlide("latex", BEAMER, slide, "figure-left") === null);
    expect(cell).toBeGreaterThanOrEqual(0);
    cellMenu(rig, cell);
    fire(menuItem("Arrange"), "click");
    fire(menuItem("Figure left"), "click");
    expect(rig.applied).toEqual([]);
    expect(rig.root.querySelector(".dw-stage-note")!.textContent).toContain("cannot write that here");
  });
});

describe("grid keys and opening", () => {
  it("A7 Delete in grid mode deletes the selected slide", async () => {
    const rig = await gridTalk();
    fire(cells(rig)[1]!, "click");
    press(cells(rig)[1]!, "Delete");
    expect(rig.applied).toEqual([deleteSourceDeckNode(BEAMER, slides[1]!)!.text]);
  });

  it("A7 Mod+D in grid mode duplicates the selected slide", async () => {
    const rig = await gridTalk();
    fire(cells(rig)[2]!, "click");
    press(cells(rig)[2]!, "d", mod());
    expect(rig.applied).toEqual([duplicateSourceDeckNode(BEAMER, slides[2]!)!.text]);
  });

  it("6.2d double-click selects the slide and switches to Visual", async () => {
    const rig = await gridTalk();
    fire(cells(rig)[2]!, "dblclick");
    expect(rig.workspace.mode()).toBe("visual");
    expect(statusLeft(rig)).toContain(`Slide ${slideAt(2) + 1} of ${slides.length}`);
  });
});
