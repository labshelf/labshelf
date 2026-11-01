/** @jest-environment jsdom */
// Tests the QMD rich editor through mountQmdEditor: typing reaches onChange, the Source toggle round-trips edits,
// and the handle (setBody, focus, destroy) and options (readOnly) behave as documented.
//
// Assumptions about the DOM, since the spec fixes no selectors: the visual surface is the ProseMirror default
// contenteditable `.ProseMirror`; Source mode is a plain <textarea>; the toggle is a <button> in the mount root
// whose text, aria-label or title mentions "source" (to enter Source) or "visual" (to return to Visual).
import { mountQmdEditor, type QmdEditorHandle } from "../../../src/qmd/dom/qmdEditor";
import { QMD_VOCABULARY } from "../../../src/qmd/dom";
import { bodyToDoc } from "../../../src/qmd/editor";
import { deriveCodeHash, formatOutput, formatPlotContent } from "../../../src/qmd/item/cellOutput";
import { formatDrawingBlock } from "../../../src/qmd/drawing/block";
import type { DrawingModel } from "../../../src/qmd/drawing/model";
import type { PlotSpec } from "../../../src/qmd/item/plotSpec";
// Side effect: the TextEncoder shim the code hash needs in jsdom.
import "../../support/nodeViewHarness";


const DEBOUNCE_MS = 300;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Lets ProseMirror's MutationObserver callback run. */
const flushDom = () => sleep(30);
const settleDebounce = () => sleep(DEBOUNCE_MS + 150);

let mounted: QmdEditorHandle[] = [];

function setup(body: string, extra: Partial<Parameters<typeof mountQmdEditor>[1]> = {}) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const changes: string[] = [];
  const handle = mountQmdEditor(root, { body, onChange: (next) => changes.push(next), ...extra });
  mounted.push(handle);
  return { root, handle, changes };
}

afterEach(() => {
  for (const handle of mounted) { try { handle.destroy(); } catch { /* already destroyed */ } }
  mounted = [];
  document.body.innerHTML = "";
});

const surface = (root: HTMLElement) => root.querySelector<HTMLElement>(".ProseMirror");

/** Replaces the first text node of the first paragraph, as typing in the browser would, and puts the caret at its end. */
async function typeText(root: HTMLElement, text: string): Promise<void> {
  const walker = document.createTreeWalker(surface(root)!, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode() as Text;
  node.data = text;
  const range = document.createRange();
  range.setStart(node, text.length);
  range.collapse(true);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  await flushDom();
}

function label(button: HTMLElement): string {
  return `${button.textContent ?? ""} ${button.getAttribute("aria-label") ?? ""} ${button.getAttribute("title") ?? ""}`;
}

/** Clicks the toggle that switches to `target`; falls back to the only toggle when a single button flips both ways. */
function toggleTo(root: HTMLElement, target: "source" | "visual"): void {
  const buttons = Array.from(root.querySelectorAll<HTMLElement>("button"));
  const exact = buttons.find((button) => new RegExp(target, "i").test(label(button)));
  const either = buttons.find((button) => /source|visual/i.test(label(button)));
  const button = exact ?? either;
  if (!button) { throw new Error(`no toggle button for ${target} found`); }
  button.click();
}

const sourceArea = (root: HTMLElement) => root.querySelector<HTMLTextAreaElement>("textarea");

describe("mountQmdEditor", () => {
  it("4.2a renders the initial body in an editable surface", () => {
    const { root } = setup("Hello\n");
    const view = surface(root);
    expect(view).not.toBeNull();
    expect(view!.textContent).toContain("Hello");
    expect(view!.getAttribute("contenteditable")).toBe("true");
  });

  it("4.2a does not call onChange on mount", async () => {
    const { changes } = setup("Hello\n");
    await settleDebounce();
    expect(changes).toEqual([]);
  });

  it("4.2a typing text gives onChange the expected body", async () => {
    const { root, changes } = setup("Hello\n");
    await typeText(root, "Hello world");
    await settleDebounce();
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[changes.length - 1]).toBe("Hello world\n");
  });

  it("4.2a debounces onChange by 300 ms and reports once for a burst of edits", async () => {
    const { root, changes } = setup("Hello\n");
    await typeText(root, "Hello w");
    await typeText(root, "Hello wo");
    await typeText(root, "Hello wor");
    await sleep(100);
    expect(changes).toEqual([]);
    await settleDebounce();
    expect(changes).toEqual(["Hello wor\n"]);
  });

  it("4.2b Source mode shows the item body in a textarea", () => {
    const { root } = setup("# Title\n\nSome text.\n");
    toggleTo(root, "source");
    const area = sourceArea(root);
    expect(area).not.toBeNull();
    expect(area!.value).toBe("# Title\n\nSome text.\n");
  });

  it("4.2b an edit made in Source mode is kept after toggling back to Visual", async () => {
    const { root } = setup("Hello\n");
    toggleTo(root, "source");
    const area = sourceArea(root)!;
    area.value = "Hello edited\n";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    toggleTo(root, "visual");
    await flushDom();
    expect(surface(root)!.textContent).toContain("Hello edited");
  });

  it("4.2b Source edits are parsed into rich nodes on return to Visual", async () => {
    const { root } = setup("Hello\n");
    toggleTo(root, "source");
    const area = sourceArea(root)!;
    area.value = "# Big title\n\nBody text.\n";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    toggleTo(root, "visual");
    await flushDom();
    expect(surface(root)!.querySelector("h1")?.textContent).toBe("Big title");
  });

  it("4.2b a Source edit reaches onChange with the edited body", async () => {
    const { root, changes } = setup("Hello\n");
    toggleTo(root, "source");
    const area = sourceArea(root)!;
    area.value = "Hello edited\n";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    toggleTo(root, "visual");
    await settleDebounce();
    expect(changes[changes.length - 1]).toBe("Hello edited\n");
  });

  it("4.2b the textarea is gone and the visual surface is back after toggling to Visual", () => {
    const { root } = setup("Hello\n");
    toggleTo(root, "source");
    toggleTo(root, "visual");
    expect(sourceArea(root)).toBeNull();
    expect(surface(root)).not.toBeNull();
  });

  it("4.2a setBody replaces the shown content", async () => {
    const { root, handle } = setup("Old\n");
    handle.setBody("New content\n");
    await flushDom();
    expect(surface(root)!.textContent).toContain("New content");
    expect(surface(root)!.textContent).not.toContain("Old");
  });

  it("4.2a readOnly makes the surface non-editable", () => {
    const { root } = setup("Hello\n", { readOnly: true });
    expect(surface(root)!.getAttribute("contenteditable")).toBe("false");
  });

  it("4.2a destroy removes the editor from the root and stops onChange", async () => {
    const { root, handle, changes } = setup("Hello\n");
    handle.destroy();
    expect(surface(root)).toBeNull();
    await settleDebounce();
    expect(changes).toEqual([]);
  });

  it("4.2a focus does not throw", () => {
    const { handle } = setup("Hello\n");
    expect(() => handle.focus()).not.toThrow();
  });
});

describe("QMD_VOCABULARY", () => {
  it("4.2a names the item in a non-empty string", () => {
    expect(typeof QMD_VOCABULARY.item).toBe("string");
    expect(QMD_VOCABULARY.item.length).toBeGreaterThan(0);
  });
});


it("offers less frequent content through the labelled Insert menu", () => {
  const { root } = setup("Hello\n");
  root.querySelector<HTMLButtonElement>('button[aria-label="Insert"]')!.click();
  const menu = document.querySelector(".ls-menu")!;
  expect(menu.textContent).toContain("Inline math");
  expect(menu.textContent).toContain("Code cell");
  const source = [...menu.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Edit Markdown source"))!;
  source.click();
  expect(root.querySelector("textarea")).not.toBeNull();
  expect(root.querySelector<HTMLButtonElement>(".qmd-editor-toggle")!.hidden).toBe(false);
  root.querySelector<HTMLButtonElement>(".qmd-editor-toggle")!.click();
  expect(root.querySelector(".ProseMirror")).not.toBeNull();
});

describe("visible controls instead of a toolbar", () => {
  const afterEachCleanup: Array<() => void> = [];
  afterEach(() => { while (afterEachCleanup.length > 0) afterEachCleanup.pop()!(); });
  /** Selects the first `length` characters of the first paragraph, as dragging over them would. */
  async function selectStart(root: HTMLElement, handle: QmdEditorHandle, length: number): Promise<void> {
    handle.focus();
    const node = document.createTreeWalker(surface(root)!, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, length);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await flushDom();
  }

  it("has no formatting toolbar", () => {
    const { root } = setup("Hello\n");
    expect(root.querySelector(".qmd-editor-toolbar, [role='toolbar']:not([hidden])")).toBeNull();
  });

  it("shows the formatting bubble over a selection and its Bold button bolds it", async () => {
    const { root, handle, changes } = setup("Hello world\n");
    const bubble = root.querySelector<HTMLElement>(".qmd-bubble")!;
    expect(bubble.hidden).toBe(true);
    await selectStart(root, handle, 5);
    expect(bubble.hidden).toBe(false);
    bubble.querySelector<HTMLButtonElement>('button[aria-label="Bold"]')!.click();
    await settleDebounce();
    expect(changes.at(-1)).toBe("**Hello** world\n");
  });

  it("the round + under the text inserts a code cell at the caret", async () => {
    // The cell's code editor measures text ranges, which jsdom lacks.
    const proto = Range.prototype as unknown as Record<string, unknown>;
    proto.getClientRects = () => [];
    proto.getBoundingClientRect = () => new DOMRect();
    afterEachCleanup.push(() => { delete proto.getClientRects; delete proto.getBoundingClientRect; });
    const { root, handle, changes } = setup("Hello\n");
    handle.focus();
    const insert = root.querySelector<HTMLButtonElement>(".qmd-editor-footer .qmd-editor-insert")!;
    insert.click();
    const item = [...document.querySelectorAll<HTMLButtonElement>(".ls-menu button")].find((button) => button.textContent?.includes("Code cell"))!;
    item.click();
    await settleDebounce();
    expect(root.querySelector(".qmd-cell")).not.toBeNull();
    expect(changes.at(-1)).toContain("```{python}");
  });

  it("a double click on empty space below the text opens the Insert menu and inserts there; on text it does not", async () => {
    const proto = Range.prototype as unknown as Record<string, unknown>;
    proto.getClientRects = () => [];
    proto.getBoundingClientRect = () => new DOMRect();
    afterEachCleanup.push(() => { delete proto.getClientRects; delete proto.getBoundingClientRect; });
    const { root, changes } = setup("Hello\n");
    surface(root)!.querySelector("p")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientY: 1 }));
    expect(document.querySelector(".ls-menu")).toBeNull();
    surface(root)!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: 40, clientY: 400 }));
    const item = [...document.querySelectorAll<HTMLButtonElement>(".ls-menu button")].find((button) => button.textContent?.includes("Code cell"))!;
    item.click();
    await settleDebounce();
    expect(changes.at(-1)).toMatch(/^Hello\n\n```\{python\}/);
  });

  it("shows the host's status at the right of the Insert row and hides Insert when read-only", () => {
    const status = document.createElement("span");
    status.textContent = "Saved";
    const root = document.createElement("div");
    document.body.append(root);
    mounted.push(mountQmdEditor(root, { body: "Hi\n", onChange: () => undefined, readOnly: true, status }));
    expect(root.querySelector(".qmd-editor-footer")!.lastElementChild).toBe(status);
    expect(root.querySelector(".qmd-editor-insert")).toBeNull();
  });
});

// --- QmdEditorHandle.outline() and reveal(pos) over real editors (spec 5.2, plan D15)
const RAN = "2026-10-22T09:15:03.000Z";
const FENCE = "```";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC";
const SPEC_2D: PlotSpec = { v: 1, dim: 2, axes: { x: {}, y: {} }, traces: [{ type: "line", x: [0, 1, 2], y: [0, 1, 0] }] };
const DRAWING_MODEL = {
  v: 1,
  points: [{ id: "A", x: 0, y: 0, dot: true, label: "$A$" }, { id: "B", x: 4, y: 0, dot: true, label: "$B$" }],
  items: [{ k: "seg", a: "A", b: "B", arrow: "end" }],
} as unknown as DrawingModel;
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

/** The top-level blocks of a body: their node type and position, as ProseMirror counts them. */
function blocksOf(body: string): { type: string; pos: number; level: number; text: string }[] {
  const out: { type: string; pos: number; level: number; text: string }[] = [];
  bodyToDoc(body).forEach((node, pos) => out.push({ type: node.type.name, pos, level: (node.attrs.level as number | undefined) ?? 0, text: node.textContent }));
  return out;
}
const selected = (root: HTMLElement): HTMLElement | null => root.querySelector<HTMLElement>(".ProseMirror-selectednode");
describe("QmdEditorHandle.outline()", () => {
  it("5.2a lists headings with their level, cells and plot outputs in document order", async () => {
    const body = await BODY_A_LINES();
    const { handle } = setup(body);
    const entries = handle.outline();
    expect(entries.map((e) => [e.kind, e.level, e.label])).toEqual([
      ["heading", 1, "Setup"],
      ["cell", 0, "Python cell · x = 1"],
      ["heading", 2, "Plot"],
      ["cell", 0, "Python cell · plot(x)"],
      ["figure", 0, "2D plot"],
    ]);
  });

  it("5.2a gives each entry the top-level position of its block", async () => {
    const body = await BODY_A_LINES();
    const { handle } = setup(body);
    const blocks = blocksOf(body);
    const at = (type: string, nth = 0): number => blocks.filter((b) => b.type === type)[nth]!.pos;
    expect(handle.outline().map((e) => e.pos)).toEqual([at("heading", 0), at("code_cell", 0), at("heading", 1), at("code_cell", 1), at("output", 1)]);
  });

  it("5.2a shows a text output as no entry of its own", async () => {
    const { handle } = setup(await BODY_A_LINES());
    expect(handle.outline().filter((e) => e.kind === "figure")).toHaveLength(1);
  });

  it("5.2a puts the error badge on the failed cell and none on a cell that ran fine", async () => {
    const { handle } = setup(await BODY_B_LINES());
    const cells = handle.outline().filter((e) => e.kind === "cell");
    expect(cells[0]!.badges).toContain("error");
    expect(cells[1]!.badges).not.toContain("error");
  });

  it("5.2a lists an image output as 'Image' and a drawing block as 'Drawing', after their cell, in order", async () => {
    const { handle } = setup(await BODY_B_LINES());
    expect(handle.outline().map((e) => [e.kind, e.label])).toEqual([
      ["heading", "Check"],
      ["cell", "Python cell · 1 / 0"],
      ["cell", "Python cell · show(img)"],
      ["figure", "Image"],
      ["figure", "Drawing"],
    ]);
  });

  it("5.2a labels a cell with its first non-empty code line", async () => {
    const body = `${FENCE}{python}\n\n\ny = 2\nz = 3\n${FENCE}\n`;
    const { handle } = setup(body);
    expect(handle.outline()[0]!.label).toBe("Python cell · y = 2");
  });

  it("5.2a cuts a long first code line to 60 characters", () => {
    const body = `${FENCE}{python}\n${"a".repeat(100)}\n${FENCE}\n`;
    const { handle } = setup(body);
    const label = handle.outline()[0]!.label;
    expect(label.startsWith("Python cell · ")).toBe(true);
    const code = label.slice("Python cell · ".length);
    expect(code).toMatch(/^a{40,60}…?$/);
    expect(code.length).toBeLessThanOrEqual(61);
  });

  it("5.2a names a cell by its language", () => {
    const body = `${FENCE}{r}\nplot(1)\n${FENCE}\n`;
    const { handle } = setup(body);
    expect(handle.outline()[0]!.label).toMatch(/^R cell · plot\(1\)/);
  });

  it("5.2a is empty for a note of plain paragraphs", () => {
    const { handle } = setup("Just text.\n\nMore text.\n");
    expect(handle.outline()).toEqual([]);
  });

  it("5.2a is empty once the editor is destroyed", async () => {
    const { handle } = setup(await BODY_A_LINES());
    handle.destroy();
    expect(handle.outline()).toEqual([]);
  });
});

describe("QmdEditorHandle.reveal(pos)", () => {
  it("5.2b selects the cell at the position of a cell entry", async () => {
    const { root, handle } = setup(await BODY_A_LINES());
    const cell = handle.outline().find((e) => e.kind === "cell" && e.label.includes("plot(x)"))!;
    handle.reveal(cell.pos);
    const hit = selected(root);
    expect(hit).not.toBeNull();
    expect(hit!.classList.contains("qmd-cell")).toBe(true);
    expect(hit!.textContent).toContain("plot(x)");
  });

  it("5.2b selects the output at the position of a figure entry", async () => {
    const { root, handle } = setup(await BODY_A_LINES());
    const figure = handle.outline().find((e) => e.kind === "figure")!;
    handle.reveal(figure.pos);
    const hit = selected(root);
    expect(hit).not.toBeNull();
    expect(hit!.classList.contains("qmd-output")).toBe(true);
  });

  it("5.2b puts the selection on the heading of a heading entry", async () => {
    const { root, handle } = setup(await BODY_A_LINES());
    const heading = handle.outline().find((e) => e.kind === "heading" && e.label === "Plot")!;
    handle.reveal(heading.pos);
    const hit = selected(root);
    const anchor = document.getSelection()?.anchorNode ?? null;
    const inHeading = anchor !== null && (anchor instanceof Element ? anchor : anchor.parentElement)?.closest("h2") != null;
    expect(inHeading || (hit !== null && hit.tagName === "H2")).toBe(true);
  });

  it("5.2b expands a collapsed cell before selecting it", async () => {
    const body = await BODY_A_LINES();
    const { handle } = setup(`${cellText("python", "alone", "q = 9")}\n${body}`);
    handle.collapseAll();
    expect(handle.foldState().cells.has("alone")).toBe(true);
    const cell = handle.outline().find((e) => e.label.includes("q = 9"))!;
    handle.reveal(cell.pos);
    expect(handle.foldState().cells.has("alone")).toBe(false);
  });

  it("5.2b expands a collapsed section holding the position", async () => {
    const { handle } = setup(await BODY_A_LINES());
    handle.collapseAll();
    expect(handle.foldState().sections.size).toBeGreaterThan(0);
    const cell = handle.outline().find((e) => e.label.includes("x = 1"))!;
    handle.reveal(cell.pos);
    expect(handle.foldState().sections.size).toBe(0);
  });

  it("5.2b focuses the editor", async () => {
    const { root, handle } = setup(await BODY_A_LINES());
    const heading = handle.outline()[0]!;
    handle.reveal(heading.pos);
    expect(root.contains(document.activeElement)).toBe(true);
  });

  it("5.2b leaves the body unchanged", async () => {
    const body = await BODY_A_LINES();
    const changes: string[] = [];
    const { handle } = setup(body, { onChange: (next) => changes.push(next) });
    handle.reveal(handle.outline()[1]!.pos);
    handle.flush();
    expect(changes).toEqual([]);
  });
});

