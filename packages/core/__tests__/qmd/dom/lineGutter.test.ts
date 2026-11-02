/** @jest-environment jsdom */
/**
 * Tests the line gutter (lineGutter.ts) through mountQmdEditor's `gutter` option and mountNoteFile: one number per top-level block (a cell's outputs share
 * its number), numbers continued across the items of a notes file, the '+' that opens the existing insert menu and inserts after its block, a click on a
 * number moving the caret to the block, and read-only views showing numbers without '+'.
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
const menuItem = (label: string): HTMLButtonElement => {
  const hit = [...document.querySelectorAll<HTMLButtonElement>(".ls-menu-item")].find((item) => item.querySelector(".ls-menu-label")?.textContent === label);
  if (!hit) throw new Error(`no menu item ${label}`);
  return hit;
};

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

  it("read-only shows numbers without '+'", () => {
    const { root } = mount("one\n\ntwo\n", { readOnly: true });
    expect(numbers(root)).toEqual(["1", "2"]);
    expect(root.querySelector(".qmd-gutter-add")).toBeNull();
  });

  it("'+' opens the insert menu and inserts after its block", () => {
    jest.useFakeTimers();
    try {
      const { root, handle, changes } = mount("one\n\ntwo\n");
      root.querySelectorAll<HTMLButtonElement>(".qmd-gutter-add")[0]!.click();
      expect(menuItem("Equation")).toBeTruthy();
      menuItem("Cell (Python)").click();
      handle.flush();
      const body = changes.at(-1)!;
      expect(body.indexOf("one")).toBeLessThan(body.indexOf("```{python}"));
      expect(body.indexOf("```{python}")).toBeLessThan(body.indexOf("two"));
      expect(numbers(root)).toEqual(["1", "2", "3"]);
    } finally { jest.useRealTimers(); }
  });

  it("'+' on a cell inserts after the cell's outputs", () => {
    jest.useFakeTimers();
    try {
      const { root, handle, changes } = mount(`${cell("x = 1")}\n${output}\nend\n`);
      expect(numbers(root)).toEqual(["1", "2"]);
      root.querySelectorAll<HTMLButtonElement>(".qmd-gutter-add")[0]!.click();
      menuItem("Drawing").click();
      handle.flush();
      expect(numbers(root)).toEqual(["1", "2", "3"]);
      const body = changes.at(-1)!;
      expect(body.lastIndexOf(":::")).toBeLessThan(body.indexOf("end"));
      expect(body.indexOf("```{python}")).toBe(0);
    } finally { jest.useRealTimers(); }
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
