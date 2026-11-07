/** @jest-environment jsdom */
/**
 * Tests the line gutter (lineGutter.ts) through mountQmdEditor's `gutter` option and mountNoteFile: one number per top-level block (a cell's outputs share
 * its number), numbers continued across the items of a notes file, no '+' of its own (the insert gaps have it), a click on a number moving the caret to
 * the block, and read-only views showing numbers.
 */
import { TextEncoder as NodeTextEncoder } from "node:util";
import { bodyToDoc } from "../../../src/qmd/editor";
import { mountQmdEditor, type QmdEditorHandle, type QmdEditorOptions } from "../../../src/qmd/dom/qmdEditor";
import { createLineNumbering, gutterLines } from "../../../src/qmd/dom/lineGutter";
import { mountNoteFile } from "../../../src/qmd/dom/mountNoteFile";
import { closeMenu } from "../../../src/ui/dom/widgets/menu";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const mounted: QmdEditorHandle[] = [];
afterEach(() => {
  closeMenu();
  while (mounted.length > 0) mounted.pop()!.destroy();
  document.body.replaceChildren();
});

const cell = (code: string): string => `\`\`\`{python}\n${code}\n\`\`\`\n`;
const output = '::: {.labshelf-output cell="cell-1" source="abc"}\n```\n1\n```\n:::\n';

function mount(body: string, extra: Partial<QmdEditorOptions> = {}, gutter = true) {
  const root = document.body.appendChild(document.createElement("div"));
  const changes: string[] = [];
  const handle = mountQmdEditor(root, { body, onChange: (next) => changes.push(next), ...(gutter ? { gutter: {} } : {}), ...extra });
  mounted.push(handle);
  return { root, handle, changes };
}
const numbers = (scope: ParentNode): string[] => [...scope.querySelectorAll(".qmd-gutter-number")].map((number) => number.textContent!);

describe("gutterLines", () => {
  it("numbers each top-level block once and gives a cell's outputs to the cell", () => {
    const doc = bodyToDoc(`intro\n\n${cell("x = 1")}\n${output}\n$$\nx\n$$\n\nend\n`);
    const lines = gutterLines(doc);
    const names = lines.map((line) => doc.nodeAt(line.pos)!.type.name);
    expect(names).toEqual(["paragraph", "code_cell", "math_display", "paragraph"]);
    // The cell's line ends after its output, where '+' inserts.
    const cellLine = lines[1]!;
    expect(doc.resolve(cellLine.end).nodeBefore!.type.name).toBe("output");
  });
});

describe("the gutter of one editor", () => {
  it("shows one number per block and renumbers after a change", () => {
    const { root, handle } = mount("one\n\ntwo\n\nthree\n");
    expect(numbers(root)).toEqual(["1", "2", "3"]);
    handle.setBody("one\n\ntwo\n\nthree\n\nfour\n");
    expect(numbers(root)).toEqual(["1", "2", "3", "4"]);
    handle.setBody("one\n");
    expect(numbers(root)).toEqual(["1"]);
  });

  it("is off without the option", () => {
    const { root } = mount("one\n", {}, false);
    expect(root.querySelector(".qmd-gutter")).toBeNull();
  });

  it("read-only shows numbers", () => {
    const { root } = mount("one\n\ntwo\n", { readOnly: true });
    expect(numbers(root)).toEqual(["1", "2"]);
  });

  it("has no '+' of its own: the insert gaps after the blocks have it", () => {
    const { root } = mount("one\n\ntwo\n");
    expect(root.querySelector(".qmd-gutter [aria-label='Insert here']")).toBeNull();
  });

  it("a click on a number moves the caret into that block", () => {
    const { root } = mount("one\n\ntwo\n");
    root.querySelectorAll<HTMLButtonElement>(".qmd-gutter-number")[1]!.click();
    const anchor = document.getSelection()?.anchorNode;
    const block = anchor instanceof Element ? anchor : anchor?.parentElement;
    expect(block?.closest("p")?.textContent).toBe("two");
  });
});

describe("continuous numbering", () => {
  it("continues across editors sharing a numbering and follows a change of an earlier one", () => {
    const numbering = createLineNumbering();
    const a = mount("a1\n\na2\n", { gutter: { numbering } });
    const b = mount("b1\n", { gutter: { numbering } });
    expect(numbers(a.root)).toEqual(["1", "2"]);
    expect(numbers(b.root)).toEqual(["3"]);
    a.handle.setBody("a1\n\na2\n\na3\n");
    expect(numbers(b.root)).toEqual(["4"]);
    a.handle.destroy();
    mounted.splice(mounted.indexOf(a.handle), 1);
    expect(numbers(b.root)).toEqual(["1"]);
  });

  it("numbers the items of a notes file continuously", () => {
    const ID_A = "n-01JABCDEFGHJKMNPQRSTVWXYZ0";
    const ID_B = "n-01JABCDEFGHJKMNPQRSTVWXYZ1";
    const item = (id: string, body: string): string => `::: {#${id} .labshelf-item}\n${body}\n:::\n`;
    const host = document.body.appendChild(document.createElement("div"));
    const handle = mountNoteFile(host, { text: `${item(ID_A, "a1\n\na2")}\n${item(ID_B, "b1\n\nb2")}`, noteKey: "k", save: () => undefined });
    expect(numbers(host)).toEqual(["1", "2", "3", "4"]);
    handle.update(`${item(ID_A, "a1")}\n${item(ID_B, "b1\n\nb2")}`);
    expect(numbers(host)).toEqual(["1", "2", "3"]);
    handle.destroy();
  });
});

describe("collapse chevrons", () => {
  it("show on cells and headings and toggle their collapse", () => {
    jest.useFakeTimers();
    try {
      const { root, handle } = mount(`# Head\n\ntext\n\n${cell("x = 1")}`);
      const folds = [...root.querySelectorAll<HTMLButtonElement>(".qmd-gutter-fold")];
      expect(folds.map((fold) => fold.hidden)).toEqual([false, true, false]);
      folds[0]!.click();
      expect([...handle.foldState().sections]).toHaveLength(1);
      jest.runOnlyPendingTimers();
      expect(root.querySelectorAll(".qmd-gutter-line")[0]!.classList.contains("is-collapsed")).toBe(true);
      root.querySelectorAll<HTMLButtonElement>(".qmd-gutter-fold")[0]!.click();
      expect([...handle.foldState().sections]).toHaveLength(0);
      root.querySelectorAll<HTMLButtonElement>(".qmd-gutter-fold")[2]!.click();
      expect([...handle.foldState().cells]).toHaveLength(1);
    } finally { jest.useRealTimers(); }
  });

  it("read-only has no chevrons", () => {
    const { root } = mount("# Head\n\ntext\n", { readOnly: true });
    expect(root.querySelector(".qmd-gutter-fold")).toBeNull();
  });
});

describe("with layout", () => {
  const proto = HTMLElement.prototype;
  const saved = { rect: proto.getBoundingClientRect, rects: proto.getClientRects, innerHeight: window.innerHeight };
  const box = (left: number, top: number, width: number, height: number): DOMRect =>
    ({ left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) }) as DOMRect;
  // A gutter 200px high at the default 20px line; block i of the editor at top 10 + 70 i, the first 40px high (two lines), the others 20px.
  beforeEach(() => {
    // A window no taller than the note, so the last editor gets the fewest empty lines.
    window.innerHeight = 200;
    // ProseMirror scrolls the selection into view once rects exist.
    (document as { elementFromPoint?: unknown }).elementFromPoint = () => null;
    proto.getClientRects = function (this: HTMLElement) { return [this.getBoundingClientRect()] as unknown as DOMRectList; };
    proto.getBoundingClientRect = function (this: HTMLElement) {
      if (this.classList.contains("qmd-gutter")) return box(0, 0, 60, 200);
      const parent = this.parentElement;
      if (parent?.classList.contains("ProseMirror")) {
        const index = [...parent.children].filter((child) => !child.classList.contains("qmd-insert-gap")).indexOf(this);
        return box(60, 10 + index * 70, 400, index === 0 ? 40 : 20);
      }
      return box(0, 0, 400, 200);
    };
  });
  afterEach(() => { proto.getBoundingClientRect = saved.rect; proto.getClientRects = saved.rects; window.innerHeight = saved.innerHeight; });

  it("fills a taller window with empty lines below a short note", () => {
    window.innerHeight = 400;
    const { root } = mount("one\n\ntwo\n");
    // Two blocks, then (400 - 200 - 24) / 20 = 8 empty lines.
    expect(numbers(root)).toHaveLength(10);
  });

  const tops = (root: ParentNode): string[] => [...root.querySelectorAll<HTMLElement>(".qmd-gutter-line")].map((line) => line.style.top);

  it("numbers each block at its first line, a tall block taking one, and five empty lines follow the last block", () => {
    const { root } = mount("one\n\ntwo\n");
    expect(numbers(root)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(tops(root)).toEqual(["10px", "80px", "100px", "120px", "140px", "160px", "180px"]);
  });

  it("gives each block's line a bar over the block, and the empty lines none", () => {
    const { root } = mount("one\n\ntwo\n");
    const bars = [...root.querySelectorAll<HTMLElement>(".qmd-gutter-bar")];
    expect(bars.map((bar) => bar.hidden)).toEqual([false, false, true, true, true, true, true]);
    // Block 0 is 40px high from top 10, its line centred on the first 20px; block 1 is 20px high at 80.
    expect([bars[0]!.style.top, bars[0]!.style.height, bars[1]!.style.top, bars[1]!.style.height]).toEqual(["0px", "40px", "0px", "20px"]);
  });

  it("gives the five trailing lines to the last editor of a shared numbering only", () => {
    jest.useFakeTimers();
    try {
      const numbering = createLineNumbering();
      const a = mount("a\n", { gutter: { numbering } });
      expect(numbers(a.root)).toHaveLength(6);
      const b = mount("b\n", { gutter: { numbering } });
      jest.runOnlyPendingTimers();
      expect(numbers(a.root)).toEqual(["1"]);
      expect(numbers(b.root)).toEqual(["2", "3", "4", "5", "6", "7"]);
      expect([a.root.classList.contains("has-gutter-trailing"), b.root.classList.contains("has-gutter-trailing")]).toEqual([false, true]);
    } finally { jest.useRealTimers(); }
  });
});
