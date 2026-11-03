/** @jest-environment jsdom */
/**
 * Tests the note outline (spec 5.2, plan D15): renderNoteOutline over fake editors (the list, its roles, the labels, badges with words, the keyboard,
 * choosing an entry, the debounced refresh) and the note menu's Outline entry in mountNoteBar. The outline over real editors is at the end; the real editor's handle is in qmdEditor.test.ts and the outline view state in
 * foldViewState.test.ts and noteViewState.test.ts.
 *
 * Written as if the file sat at packages/core/__tests__/qmd/dom/noteOutline.test.ts; the helpers are copied here, nothing is imported from other tests.
 * Assumptions where the spec fixes no selector: the list carries role "list" and each entry is a role "listitem" wrapper holding one <button>; the
 * panel (or its list) carries class qmd-outline; a closed panel is absent or hidden; the figure of a drawing is the 'Drawing' entry at the drawing's top-level position.
 */
import { renderNoteOutline, type OutlineEntry } from "../../../src/qmd/dom/noteOutline";
import { mountNoteBar, type NoteBarEditor } from "../../../src/qmd/dom/noteBar";
import { mountQmdEditor, type QmdEditorHandle } from "../../../src/qmd/dom/qmdEditor";
import { deriveCodeHash, formatOutput, formatPlotContent } from "../../../src/qmd/item/cellOutput";
import { formatDrawingBlock } from "../../../src/drawing/drawingBlock";
import type { DrawingModel } from "../../../src/drawing/drawingModel";
import type { PlotSpec } from "../../../src/qmd/item/plotSpec";
// Side effect: the TextEncoder shim the code hash needs in jsdom.
import "../../support/nodeViewHarness";
import { closeMenu } from "../../../src/ui/dom/widgets/menu";

// jsdom has no layout; CodeMirror measures text ranges.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const DEBOUNCE_MS = 200;
const advance = (ms: number): void => { jest.advanceTimersByTime(ms); };


// --- fake editors -----------------------------------------------------------------------------------------------------------------------------

const entry = (kind: OutlineEntry["kind"], pos: number, level: number, label: string, badges: OutlineEntry["badges"] = []): OutlineEntry => ({ kind, pos, level, label, badges });

interface FakeEditor extends NoteBarEditor {
  entries: OutlineEntry[];
  open: boolean;
  fake: Record<"outline" | "reveal" | "outlineOpen" | "setOutlineOpen" | "foldState", jest.Mock>;
}

function fakeEditor(itemId: string, entries: OutlineEntry[], open = false): FakeEditor {
  const editor = { itemId, entries, open } as FakeEditor;
  const fake = {
    outline: jest.fn(() => editor.entries),
    reveal: jest.fn(),
    outlineOpen: jest.fn(() => editor.open),
    setOutlineOpen: jest.fn((value: boolean) => { editor.open = value; }),
    foldState: jest.fn(() => ({ cells: new Set<string>(), sections: new Set<string>(), reading: false })),
  };
  const handle = {
    ...fake,
    setBody: jest.fn(), flush: jest.fn(), focus: jest.fn(), destroy: jest.fn(),
    sections: jest.fn(() => []), notebook: jest.fn(() => []), markUpstreamChange: jest.fn(),
    collapseAll: jest.fn(), expandAll: jest.fn(), setReading: jest.fn(),
  };
  (editor as { handle: QmdEditorHandle }).handle = handle as unknown as QmdEditorHandle;
  editor.fake = fake;
  return editor;
}

const FIRST: OutlineEntry[] = [entry("heading", 0, 1, "Setup"), entry("cell", 10, 0, "Python cell · x = 1"), entry("figure", 40, 0, "2D plot")];
const SECOND: OutlineEntry[] = [entry("heading", 0, 2, "Check", []), entry("cell", 12, 0, "R cell · stop()", ["error"])];

// --- DOM helpers ----------------------------------------------------------------------------------------------------------------------------

let mounted: QmdEditorHandle[] = [];
afterEach(() => {
  closeMenu();
  document.body.innerHTML = "";
  jest.useRealTimers();
  for (const handle of mounted) { try { handle.destroy(); } catch { /* already destroyed */ } }
  mounted = [];
});

function newHost(): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
}
const listOf = (host: HTMLElement): HTMLElement | null => host.querySelector<HTMLElement>('[role="list"]');
const itemsOf = (host: HTMLElement): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[role="listitem"]')];
const buttonsOf = (host: HTMLElement): HTMLButtonElement[] => itemsOf(host).map((item) => item.querySelector<HTMLButtonElement>("button")!);
const texts = (host: HTMLElement): string[] => itemsOf(host).map((item) => item.textContent ?? "");
const keydown = (target: Element, key: string): void => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); };

function mountOutline(editors: readonly FakeEditor[]): { host: HTMLElement; outline: ReturnType<typeof renderNoteOutline> } {
  jest.useFakeTimers();
  const host = newHost();
  const outline = renderNoteOutline(host, () => editors);
  advance(DEBOUNCE_MS);
  return { host, outline };
}

// --- renderNoteOutline: list, labels, badges -----------------------------------------------------------------------------------------------------

// Every test first goes through the seam, so it fails the same way before the implementation exists.
beforeEach(() => { renderNoteOutline(document.createElement("div"), () => []).destroy(); });

describe("renderNoteOutline list", () => {
  it("5.2a renders one role list with one role listitem per entry, in editors() order", () => {
    const { host } = mountOutline([fakeEditor("a", FIRST), fakeEditor("b", SECOND)]);
    expect(host.querySelectorAll('[role="list"]')).toHaveLength(1);
    expect(itemsOf(host)).toHaveLength(FIRST.length + SECOND.length);
    expect(itemsOf(host).every((item) => listOf(host)!.contains(item))).toBe(true);
  });

  it("5.2a gives every list entry a button and the qmd-outline class to the panel", () => {
    const { host } = mountOutline([fakeEditor("a", FIRST), fakeEditor("b", SECOND)]);
    expect(host.querySelector(".qmd-outline")).not.toBeNull();
    for (const item of itemsOf(host)) expect(item.querySelector("button")).not.toBeNull();
  });

  it("5.2a shows the headings, cells and figures of the two items in note order", () => {
    const { host } = mountOutline([fakeEditor("a", FIRST), fakeEditor("b", SECOND)]);
    const expected = ["Setup", "Python cell · x = 1", "2D plot", "Check", "R cell · stop()"];
    const shown = texts(host);
    expected.forEach((label, index) => expect(shown[index]).toContain(label));
  });

  it("5.2a puts 'Error' on the failed cell and on no other entry", () => {
    const { host } = mountOutline([fakeEditor("a", FIRST), fakeEditor("b", SECOND)]);
    const shown = texts(host);
    expect(shown[4]).toContain("Error");
    shown.slice(0, 4).forEach((text) => expect(text).not.toContain("Error"));
  });

  it("5.2a spells the three badges as words: Error, Out of date, May be out of date", () => {
    const entries = [
      entry("cell", 0, 0, "Python cell · a", ["error"]),
      entry("cell", 10, 0, "Python cell · b", ["out-of-date"]),
      entry("cell", 20, 0, "Python cell · c", ["maybe-stale"]),
    ];
    const { host } = mountOutline([fakeEditor("a", entries)]);
    const [error, outOfDate, maybe] = texts(host);
    expect(error).toContain("Error");
    expect(outOfDate).toContain("Out of date");
    expect(maybe).toContain("May be out of date");
    expect(maybe).not.toContain("Out of date");
  });

  it("5.2a shows both badges of an entry that has two", () => {
    const { host } = mountOutline([fakeEditor("a", [entry("cell", 0, 0, "Python cell · a", ["error", "out-of-date"])])]);
    const [text] = texts(host);
    expect(text).toContain("Error");
    expect(text).toContain("Out of date");
  });

  it("A10 lists entries with badges", () => {
    const { host } = mountOutline([fakeEditor("a", FIRST), fakeEditor("b", SECOND)]);
    expect(itemsOf(host)).toHaveLength(5);
    expect(texts(host)[4]).toContain("Error");
  });

  it("5.2a reads each editor's handle.outline() when rendering", () => {
    const a = fakeEditor("a", FIRST);
    const b = fakeEditor("b", SECOND);
    mountOutline([a, b]);
    expect(a.fake.outline).toHaveBeenCalled();
    expect(b.fake.outline).toHaveBeenCalled();
  });

  it("5.2a destroy removes the list from the host", () => {
    const { host, outline } = mountOutline([fakeEditor("a", FIRST)]);
    outline.destroy();
    expect(host.querySelector('[role="list"]')).toBeNull();
    expect(host.querySelector(".qmd-outline")).toBeNull();
  });
});

// --- choosing an entry ---------------------------------------------------------------------------------------------------------------------------

describe("renderNoteOutline choosing an entry", () => {
  it("5.2b clicking an entry calls reveal(entry.pos) on its own editor only", () => {
    const a = fakeEditor("a", FIRST);
    const b = fakeEditor("b", SECOND);
    const { host } = mountOutline([a, b]);
    buttonsOf(host)[4]!.click();
    expect(b.fake.reveal).toHaveBeenCalledWith(12);
    expect(a.fake.reveal).not.toHaveBeenCalled();
  });

  it("5.2b clicking an entry of the first editor reveals in the first editor", () => {
    const a = fakeEditor("a", FIRST);
    const b = fakeEditor("b", SECOND);
    const { host } = mountOutline([a, b]);
    buttonsOf(host)[2]!.click();
    expect(a.fake.reveal).toHaveBeenCalledWith(40);
    expect(b.fake.reveal).not.toHaveBeenCalled();
  });

  it("5.2b Enter on a focused entry calls reveal(entry.pos) on its editor", () => {
    const a = fakeEditor("a", FIRST);
    const b = fakeEditor("b", SECOND);
    const { host } = mountOutline([a, b]);
    const button = buttonsOf(host)[3]!;
    button.focus();
    keydown(button, "Enter");
    expect(b.fake.reveal).toHaveBeenLastCalledWith(0);
    expect(a.fake.reveal).not.toHaveBeenCalled();
  });

  it("A10 a choice jumps: the chosen entry's editor is asked to reveal its position", () => {
    const a = fakeEditor("a", FIRST);
    const { host } = mountOutline([a]);
    buttonsOf(host)[1]!.click();
    expect(a.fake.reveal).toHaveBeenCalledWith(10);
  });
});

describe("renderNoteOutline keyboard", () => {
  it("5.2b ArrowDown moves focus to the next entry's button", () => {
    const { host } = mountOutline([fakeEditor("a", FIRST), fakeEditor("b", SECOND)]);
    const buttons = buttonsOf(host);
    buttons[0]!.focus();
    keydown(buttons[0]!, "ArrowDown");
    expect(document.activeElement).toBe(buttons[1]);
  });

  it("5.2b ArrowDown crosses from the last entry of one editor to the first of the next", () => {
    const { host } = mountOutline([fakeEditor("a", FIRST), fakeEditor("b", SECOND)]);
    const buttons = buttonsOf(host);
    buttons[2]!.focus();
    keydown(buttons[2]!, "ArrowDown");
    expect(document.activeElement).toBe(buttons[3]);
  });

  it("5.2b ArrowUp moves focus to the previous entry's button", () => {
    const { host } = mountOutline([fakeEditor("a", FIRST), fakeEditor("b", SECOND)]);
    const buttons = buttonsOf(host);
    buttons[3]!.focus();
    keydown(buttons[3]!, "ArrowUp");
    expect(document.activeElement).toBe(buttons[2]);
  });

  it("5.2b moving with the arrow keys reveals nothing", () => {
    const a = fakeEditor("a", FIRST);
    const { host } = mountOutline([a]);
    const buttons = buttonsOf(host);
    buttons[0]!.focus();
    keydown(buttons[0]!, "ArrowDown");
    keydown(buttons[1]!, "ArrowDown");
    expect(a.fake.reveal).not.toHaveBeenCalled();
  });
});

// --- refresh -----------------------------------------------------------------------------------------------------------------------------

describe("renderNoteOutline refresh", () => {
  it("5.2a shows the changed outline of an editor within 200 ms of refresh()", () => {
    const a = fakeEditor("a", FIRST);
    const { host, outline } = mountOutline([a]);
    a.entries = [...FIRST, entry("cell", 60, 0, "Python cell · y = 2", ["out-of-date"])];
    outline.refresh();
    advance(DEBOUNCE_MS);
    expect(itemsOf(host)).toHaveLength(4);
    expect(texts(host)[3]).toContain("Python cell · y = 2");
    expect(texts(host)[3]).toContain("Out of date");
  });

  it("5.2a drops entries that are gone after a refresh", () => {
    const a = fakeEditor("a", FIRST);
    const { host, outline } = mountOutline([a]);
    a.entries = [FIRST[0]!];
    outline.refresh();
    advance(DEBOUNCE_MS);
    expect(texts(host)).toHaveLength(1);
    expect(texts(host)[0]).toContain("Setup");
  });

  it("5.2a a refresh keeps reveal working on the new positions", () => {
    const a = fakeEditor("a", FIRST);
    const { host, outline } = mountOutline([a]);
    a.entries = [entry("heading", 5, 1, "Moved")];
    outline.refresh();
    advance(DEBOUNCE_MS);
    buttonsOf(host)[0]!.click();
    expect(a.fake.reveal).toHaveBeenCalledWith(5);
  });

  it("5.2a refresh never steals focus from an element outside the outline", () => {
    const a = fakeEditor("a", FIRST);
    const { host, outline } = mountOutline([a]);
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    a.entries = [...FIRST, entry("cell", 60, 0, "Python cell · z", [])];
    outline.refresh();
    advance(DEBOUNCE_MS);
    expect(document.activeElement).toBe(input);
    expect(itemsOf(host)).toHaveLength(4);
  });
});

// --- the note menu's Outline entry --------------------------------------------------------------------------------------------------------------

const menuOf = (): HTMLElement | null => document.querySelector<HTMLElement>(".ls-menu");
const menuLabels = (): string[] =>
  [...menuOf()!.children].map((child) => (child.getAttribute("role") === "separator" ? "---" : child.querySelector(".ls-menu-label")!.textContent!));
const menuItem = (label: string): HTMLButtonElement => {
  const hit = [...menuOf()!.querySelectorAll<HTMLButtonElement>(".ls-menu-item")].find((item) => item.querySelector(".ls-menu-label")!.textContent === label);
  if (!hit) throw new Error(`no menu item ${label}`);
  return hit;
};

interface BarSetup { host: HTMLElement; bar: ReturnType<typeof mountNoteBar>; a: FakeEditor; b: FakeEditor }

function mountBar(opts: { openA?: boolean } = {}): BarSetup {
  jest.useFakeTimers();
  const host = newHost();
  const a = fakeEditor("a", FIRST, opts.openA ?? false);
  const b = fakeEditor("b", SECOND);
  const bar = mountNoteBar(host, { editors: () => [a, b], flush: () => undefined, restart: async () => undefined, canRun: () => true });
  advance(DEBOUNCE_MS);
  return { host, bar, a, b };
}
const moreButton = (host: HTMLElement): HTMLButtonElement => host.querySelector<HTMLButtonElement>('.qmd-note-bar button[aria-label="Note actions"]')!;
const panelOf = (host: HTMLElement): HTMLElement | null => {
  const panel = host.querySelector<HTMLElement>(".qmd-outline");
  if (!panel || panel.hidden || panel.closest("[hidden]")) return null;
  return panel;
};
const toggleOutline = (host: HTMLElement): void => {
  moreButton(host).click();
  menuItem("Outline").click();
  advance(DEBOUNCE_MS);
};

describe("the note menu's Outline entry", () => {
  it("5.2a lists Outline right after Previous problem", () => {
    const { host } = mountBar();
    moreButton(host).click();
    const labels = menuLabels();
    expect(labels).toContain("Outline");
    expect(labels.indexOf("Outline")).toBe(labels.indexOf("Previous problem") + 1);
  });

  it("5.2a shows Outline unchecked while the panel is closed", () => {
    const { host } = mountBar();
    moreButton(host).click();
    expect(menuItem("Outline").getAttribute("aria-checked")).toBe("false");
  });

  it("5.2a keeps the panel closed until Outline is chosen", () => {
    const { host } = mountBar();
    expect(panelOf(host)).toBeNull();
  });

  it("5.2a choosing Outline opens the panel under the note bar with the entries of every editor", () => {
    const { host } = mountBar();
    toggleOutline(host);
    const panel = panelOf(host);
    expect(panel).not.toBeNull();
    const bar = host.querySelector(".qmd-note-bar")!;
    expect(bar.compareDocumentPosition(panel!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(itemsOf(host)).toHaveLength(FIRST.length + SECOND.length);
    expect(texts(host)[4]).toContain("Error");
  });

  it("5.2a choosing Outline calls setOutlineOpen(true) on the first editor only", () => {
    const { host, a, b } = mountBar();
    toggleOutline(host);
    expect(a.fake.setOutlineOpen).toHaveBeenCalledWith(true);
    expect(b.fake.setOutlineOpen).not.toHaveBeenCalled();
  });

  it("5.2a shows Outline checked while the panel is open", () => {
    const { host } = mountBar();
    toggleOutline(host);
    moreButton(host).click();
    expect(menuItem("Outline").getAttribute("aria-checked")).toBe("true");
  });

  it("5.2a choosing Outline again closes the panel and calls setOutlineOpen(false) on the first editor", () => {
    const { host, a, b } = mountBar();
    toggleOutline(host);
    closeMenu();
    toggleOutline(host);
    expect(panelOf(host)).toBeNull();
    expect(a.fake.setOutlineOpen).toHaveBeenLastCalledWith(false);
    expect(b.fake.setOutlineOpen).not.toHaveBeenCalled();
  });

  it("5.2a opens the panel on mount when the first editor's outlineOpen() is true", () => {
    const { host, a } = mountBar({ openA: true });
    expect(a.fake.outlineOpen).toHaveBeenCalled();
    expect(panelOf(host)).not.toBeNull();
    expect(itemsOf(host)).toHaveLength(FIRST.length + SECOND.length);
  });

  it("5.2a opens the panel on refresh() once the first editor's outlineOpen() turns true", () => {
    const { host, bar, a } = mountBar();
    expect(panelOf(host)).toBeNull();
    a.open = true;
    bar.refresh();
    advance(DEBOUNCE_MS);
    expect(panelOf(host)).not.toBeNull();
  });

  it("5.2a a panel opened on mount shows Outline checked", () => {
    const { host } = mountBar({ openA: true });
    moreButton(host).click();
    expect(menuItem("Outline").getAttribute("aria-checked")).toBe("true");
  });

  it("5.2b choosing an entry of the panel reveals it in its editor", () => {
    const { host, a, b } = mountBar({ openA: true });
    buttonsOf(host)[4]!.click();
    expect(b.fake.reveal).toHaveBeenCalledWith(12);
    expect(a.fake.reveal).not.toHaveBeenCalled();
  });

  it("5.2a destroy removes the panel with the bar", () => {
    const { host, bar } = mountBar({ openA: true });
    bar.destroy();
    expect(host.querySelector(".qmd-outline")).toBeNull();
    expect(host.querySelector(".qmd-note-bar")).toBeNull();
  });
});

// --- the outline over real editors (spec 5.2, plan D15)
const RAN = "2026-10-22T09:15:03.000Z";
const FENCE = "```";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC";
const SPEC_2D: PlotSpec = { v: 1, dim: 2, axes: { x: {}, y: {} }, traces: [{ type: "line", x: [0, 1, 2], y: [0, 1, 0] }] };
const DRAWING_MODEL = { v: 1, points: [{ id: "A", x: 0, y: 0, dot: true, label: "$A$" }, { id: "B", x: 4, y: 0, dot: true, label: "$B$" }], items: [{ k: "seg", a: "A", b: "B", arrow: "end" }] } as unknown as DrawingModel;
const TIKZ = ["\\begin{tikzpicture}[x=0.5cm,y=0.5cm,>=stealth,line width=0.6pt]", "\\coordinate (A) at (0,0);", "\\coordinate (B) at (4,0);", "\\draw[->] (A) -- (B);", "\\end{tikzpicture}"].join("\n");
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>';
const cellText = (lang: string, label: string, code: string): string => `${FENCE}{${lang}}\n#| label: ${label}\n${code}\n${FENCE}\n`;
const outputText = async (label: string, code: string, content: string, status?: "error"): Promise<string> =>
  formatOutput({ cell: label, source: await deriveCodeHash(code + "\n"), engine: "python-3.12", ran: RAN, content, ...(status ? { status } : {}) });
const BODY_A_LINES = async (): Promise<string> => [
  "# Setup\n",
  cellText("python", "first", "x = 1"), await outputText("first", "x = 1", "one\n"),
  "## Plot\n",
  cellText("python", "plotted", "plot(x)"), await outputText("plotted", "plot(x)", formatPlotContent({ alt: "Python plot", src: PNG }, SPEC_2D)),
].join("\n");
const BODY_B_LINES = async (): Promise<string> => {
  const drawing = formatDrawingBlock({ model: DRAWING_MODEL, tikz: TIKZ, png: PNG, alt: "Drawing A B", svg: SVG }, "\n");
  if (drawing === null) throw new Error("drawing block did not format");
  return [
    "# Check\n",
    cellText("python", "broken", "1 / 0"), await outputText("broken", "1 / 0", "ZeroDivisionError: division by zero\n", "error"),
    cellText("python", "shown", "show(img)"), await outputText("shown", "show(img)", `![Python plot](${PNG})\n`),
    drawing + "\n",
  ].join("\n");
};
function realEditor(body: string): { root: HTMLElement; handle: QmdEditorHandle } {
  const root = newHost();
  const handle = mountQmdEditor(root, { body, onChange: () => undefined });
  mounted.push(handle);
  return { root, handle };
}
const selected = (root: HTMLElement): HTMLElement | null => root.querySelector<HTMLElement>(".ProseMirror-selectednode");

describe("the outline over real editors", () => {
  it("5.2a lists the headings, cells and figures of two items in order, with 'Error' on the failed cell", async () => {
    const a = realEditor(await BODY_A_LINES());
    const b = realEditor(await BODY_B_LINES());
    const host = newHost();
    const editors: NoteBarEditor[] = [{ itemId: "a", handle: a.handle }, { itemId: "b", handle: b.handle }];
    const outline = renderNoteOutline(host, () => editors);
    const expected = ["Setup", "Python cell · x = 1", "Plot", "Python cell · plot(x)", "2D plot", "Check", "Python cell · 1 / 0", "Python cell · show(img)", "Image", "Diagram"];
    const shown = texts(host);
    expect(shown).toHaveLength(expected.length);
    expected.forEach((label, index) => expect(shown[index]).toContain(label));
    expect(shown[6]).toContain("Error");
    expect(shown.filter((text) => text.includes("Error"))).toHaveLength(1);
    outline.destroy();
  });

  it("5.2b choosing an entry selects that block in its editor", async () => {
    const a = realEditor(await BODY_A_LINES());
    const b = realEditor(await BODY_B_LINES());
    const host = newHost();
    const outline = renderNoteOutline(host, () => [{ itemId: "a", handle: a.handle }, { itemId: "b", handle: b.handle }]);
    buttonsOf(host)[6]!.click();
    const hit = selected(b.root);
    expect(hit).not.toBeNull();
    expect(hit!.textContent).toContain("1 / 0");
    expect(selected(a.root)).toBeNull();
    outline.destroy();
  });

  it("A10 outline with badges; choice jumps", async () => {
    const a = realEditor(await BODY_A_LINES());
    const b = realEditor(await BODY_B_LINES());
    const host = newHost();
    const outline = renderNoteOutline(host, () => [{ itemId: "a", handle: a.handle }, { itemId: "b", handle: b.handle }]);
    expect(texts(host)[6]).toContain("Error");
    buttonsOf(host)[3]!.click();
    expect(selected(a.root)!.textContent).toContain("plot(x)");
    outline.destroy();
  });
});

