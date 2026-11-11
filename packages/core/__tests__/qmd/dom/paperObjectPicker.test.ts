/** @jest-environment jsdom */
/**
 * Tests From paper… in a mounted notes file: the Insert panel entry only with the option, the picker over a fake PaperObjectsPort (the default paper's
 * sections, the filter, Enter inserting through the files port then as real blocks, the equation labels taken in the whole file, the error without a
 * files port) and the paper search; plus the pure helpers equationLabelsIn and matchesPaperObject.
 */
import { TextEncoder as NodeTextEncoder } from "node:util";
import type { Node as PmNode } from "prosemirror-model";
import { mountNoteFile } from "../../../src/qmd/dom/mountNoteFile";
import { equationLabelsIn, matchesPaperObject } from "../../../src/qmd/dom/paperObjectPicker";
import { bodyToDoc } from "../../../src/qmd/editor";
import { closeMenu } from "../../../src/ui/dom/widgets/menu";
import type { NoteFilesPort } from "../../../src/qmd/noteFiles";
import type { PaperChoice, PaperObject, PaperObjectInsert, PaperObjectsPort } from "../../../src/paperObjects/types";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const ID_A = "n-01JABCDEFGHJKMNPQRSTVWXYZ0";
const ID_B = "n-01JABCDEFGHJKMNPQRSTVWXYZ1";
const item = (id: string, body: string): string => `::: {#${id} .labshelf-item}\n${body}\n:::\n`;

const OBJECTS: PaperObject[] = [
  { kind: "equation", label: "1", page: 2, box: { x: 0, y: 0, w: 1, h: 0.1 }, caption: "E = mc^2" },
  { kind: "equation", label: "3", page: 4, box: { x: 0, y: 0, w: 1, h: 0.1 }, caption: "F = ma" },
  { kind: "figure", label: "2", page: 5, box: { x: 0, y: 0, w: 1, h: 0.4 }, caption: "Results of the sweep" },
];
const PAPERS: PaperChoice[] = [{ id: "p-smith", citeKey: "smith2020", title: "On sweeps", authors: "Smith, Jones", year: "2020" }];
const MARKDOWN = "$$\nF = ma\n$$ {#eq-3}\n\n![Figure 2](assets/a.png)\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[Smith 2020, Eq. (3), p. 4](labshelf:paper/p-smith#page=4)";
const PNG = new Uint8Array([137, 80, 78, 71]);

function fakePort(result: PaperObjectInsert = { markdown: MARKDOWN, assets: [{ path: "assets/a.png", bytes: PNG }], via: "arxiv" }) {
  const port = {
    papers: jest.fn(async (_query: string) => PAPERS),
    list: jest.fn(async (_id: string) => OBJECTS),
    preview: jest.fn(async () => null),
    insert: jest.fn(async () => result),
  };
  return port satisfies PaperObjectsPort;
}

function fakeFiles(order: string[]): NoteFilesPort & { write: jest.Mock } {
  return { read: jest.fn(async () => null), write: jest.fn(async (path: string) => { order.push(`write ${path}`); }), pickTextFile: jest.fn(async () => null) };
}

function mount(text: string, extra: Partial<Parameters<typeof mountNoteFile>[1]> = {}) {
  const host = document.body.appendChild(document.createElement("div"));
  const saves: [string, string][] = [];
  const handle = mountNoteFile(host, { text, noteKey: "paper:p1", save: (id, body) => saves.push([id, body]), ...extra });
  return { host, saves, handle };
}

const settle = async (ms = 0): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, ms)); };
const anchor = (): HTMLElement => document.body.appendChild(document.createElement("button"));
const panelItems = (): string[] => [...document.querySelectorAll(".ls-section-panel button span:first-of-type")].map((span) => span.textContent ?? "");
const panelItem = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>(".ls-section-panel button")].find((button) => button.querySelector("span")?.textContent === label)!;
const picker = (): HTMLElement => document.querySelector<HTMLElement>(".qmd-paper-pick")!;
const input = (): HTMLInputElement => picker().querySelector<HTMLInputElement>(".qmd-paper-pick-input")!;
const rowTitles = (): string[] => [...picker().querySelectorAll(".qmd-paper-pick-row .qmd-paper-pick-title")].map((el) => el.textContent ?? "");
const headings = (): string[] => [...picker().querySelectorAll(".qmd-paper-pick-heading")].map((el) => el.textContent ?? "");
const key = (key: string): void => { input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); };
const type = (text: string): void => { input().value = text; input().dispatchEvent(new Event("input", { bubbles: true })); };

async function openPicker(ctx: ReturnType<typeof mount>, index = 0): Promise<void> {
  ctx.handle.editors[index]!.handle.openInsertMenu(anchor());
  panelItem("From paper…").click();
  await settle();
}

const topLevel = (doc: PmNode): PmNode[] => { const out: PmNode[] = []; doc.forEach((node) => out.push(node)); return out; };

afterEach(() => { closeMenu(); document.body.replaceChildren(); });

describe("From paper… entry", () => {
  it("appears in Math and figures only when the note has the option", () => {
    const without = mount(item(ID_A, "Text"));
    without.handle.editors[0]!.handle.openInsertMenu(anchor());
    expect(panelItems()).not.toContain("From paper…");
    closeMenu();
    const withOption = mount(item(ID_A, "Text"), { paperObjects: { port: fakePort() } });
    withOption.handle.editors[0]!.handle.openInsertMenu(anchor());
    const section = [...document.querySelectorAll(".ls-section-panel-section")].find((el) => el.querySelector("h3")?.textContent === "Math and figures")!;
    expect([...section.querySelectorAll("button > span:first-of-type")].map((span) => span.textContent)).toEqual(["Equation", "Figure", "Table", "From paper…"]);
  });
});

describe("the picker", () => {
  it("starts on the default paper and lists its non-empty sections", async () => {
    const port = fakePort();
    const ctx = mount(item(ID_A, "Text"), { paperObjects: { port, defaultPaperId: "p-smith" } });
    await openPicker(ctx);
    expect(port.list).toHaveBeenCalledWith("p-smith");
    expect(port.papers).not.toHaveBeenCalled();
    expect(headings()).toEqual(["Equations", "Figures"]);
    expect(rowTitles()).toEqual(["Eq. (1)", "Eq. (3)", "Figure 2"]);
    expect(picker().textContent).toContain("Change paper");
    expect(picker().textContent).toContain("p. 5");
  });

  it("filters by number, kind abbreviation and both", async () => {
    const ctx = mount(item(ID_A, "Text"), { paperObjects: { port: fakePort(), defaultPaperId: "p-smith" } });
    await openPicker(ctx);
    type("3");
    expect(rowTitles()).toEqual(["Eq. (3)"]);
    type("fig 2");
    expect(rowTitles()).toEqual(["Figure 2"]);
    type("tab");
    expect(rowTitles()).toEqual([]);
    expect(picker().textContent).toContain("Nothing matches");
  });

  it("says when the paper has nothing numbered", async () => {
    const port = fakePort();
    port.list.mockResolvedValueOnce([]);
    const ctx = mount(item(ID_A, "Text"), { paperObjects: { port, defaultPaperId: "p-smith" } });
    await openPicker(ctx);
    expect(picker().textContent).toContain("No numbered equations, figures or tables found in this PDF.");
  });

  it("Enter writes the assets, then inserts the markdown as real blocks after the caret's block and closes", async () => {
    const order: string[] = [];
    const port = fakePort();
    port.insert.mockImplementation(async () => { order.push("insert"); return { markdown: MARKDOWN, assets: [{ path: "assets/a.png", bytes: PNG }], via: "arxiv" }; });
    const files = fakeFiles(order);
    const ctx = mount(item(ID_A, "Intro\n\nOutro"), { paperObjects: { port, defaultPaperId: "p-smith" }, files });
    await openPicker(ctx);
    type("3");
    key("Enter");
    await settle();
    expect(order).toEqual(["insert", "write assets/a.png"]);
    expect(files.write).toHaveBeenCalledWith("assets/a.png", PNG);
    expect(document.querySelector(".qmd-paper-pick")).toBeNull();
    ctx.handle.editors[0]!.handle.flush();
    const body = ctx.saves.at(-1)![1];
    expect(body).toContain(MARKDOWN);
    const nodes = topLevel(bodyToDoc(body));
    const math = nodes.find((node) => node.type.name === "math_display")!;
    expect(math.attrs.label).toBe("eq-3");
    expect(math.attrs.tex.trim()).toBe("F = ma");
    let image = false;
    bodyToDoc(body).descendants((node) => { if (node.type.name === "image") image = node.attrs.src === "assets/a.png"; return true; });
    expect(image).toBe(true);
    expect(nodes.some((node) => node.type.name === "table")).toBe(true);
    expect(nodes.some((node) => node.type.name === "paragraph" && node.textContent.startsWith("Smith 2020"))).toBe(true);
  });

  it("passes the equation labels of every item of the note, and asImage from the row's As image", async () => {
    const port = fakePort();
    const text = `${item(ID_A, "$$\nx\n$$ {#eq-1}")}\n${item(ID_B, "See $$y$$ and\n\n$$\ny\n$$ {#eq-sweep}")}`;
    const ctx = mount(text, { paperObjects: { port, defaultPaperId: "p-smith" }, files: fakeFiles([]) });
    await openPicker(ctx, 1);
    picker().querySelectorAll<HTMLButtonElement>(".qmd-paper-pick-image")[1]!.click();
    await settle();
    const [paperId, object, options] = port.insert.mock.calls[0] as unknown as [string, PaperObject, { takenLabels: string[]; assetName: string; asImage?: boolean }];
    expect(paperId).toBe("p-smith");
    expect(object.label).toBe("3");
    expect([...options.takenLabels].sort()).toEqual(["1", "sweep"]);
    expect(options.assetName).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(options.asImage).toBe(true);
  });

  it("without a files port, an insert with assets shows an error and inserts nothing", async () => {
    const port = fakePort();
    const ctx = mount(item(ID_A, "Intro"), { paperObjects: { port, defaultPaperId: "p-smith" } });
    await openPicker(ctx);
    key("Enter");
    await settle();
    expect(picker().querySelector(".rd-cite-dialog-status")!.textContent).toBe("This editor cannot save images");
    ctx.handle.editors[0]!.handle.flush();
    expect(ctx.saves).toEqual([]);
  });

  it("shows a port failure in the picker", async () => {
    const port = fakePort();
    port.insert.mockRejectedValueOnce(new Error("PDF unreadable"));
    const ctx = mount(item(ID_A, "Intro"), { paperObjects: { port, defaultPaperId: "p-smith" }, files: fakeFiles([]) });
    await openPicker(ctx);
    key("Enter");
    await settle();
    expect(picker().querySelector(".rd-cite-dialog-status")!.textContent).toContain("PDF unreadable");
  });

  it("without a default paper searches the library, then opens the chosen paper", async () => {
    const port = fakePort();
    const ctx = mount(item(ID_A, "Intro"), { paperObjects: { port } });
    await openPicker(ctx);
    expect(port.papers).toHaveBeenCalledWith("");
    expect(rowTitles()).toEqual(["On sweeps"]);
    expect(picker().textContent).toContain("Smith, Jones · 2020");
    expect(picker().textContent).toContain("smith2020");
    type("smith");
    await settle(60);
    expect(port.papers).toHaveBeenLastCalledWith("smith");
    key("Enter");
    await settle();
    expect(port.list).toHaveBeenCalledWith("p-smith");
    expect(rowTitles()).toEqual(["Eq. (1)", "Eq. (3)", "Figure 2"]);
  });
});

describe("helpers", () => {
  it("equationLabelsIn collects eq- labels without the prefix, once each", () => {
    expect(equationLabelsIn(["$$x$$ {#eq-1}\n$$y$$ {#eq-a.b}", "{#eq-1} {#fig-2}"])).toEqual(["1", "a.b"]);
  });
  it("matchesPaperObject matches word starts of kind, label and caption", () => {
    expect(matchesPaperObject(OBJECTS[2]!, "fig 2")).toBe(true);
    expect(matchesPaperObject(OBJECTS[2]!, "sweep")).toBe(true);
    expect(matchesPaperObject(OBJECTS[1]!, "eq 3")).toBe(true);
    expect(matchesPaperObject(OBJECTS[1]!, "fig")).toBe(false);
  });
});
