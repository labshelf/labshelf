/** @jest-environment jsdom */
// Spec 7.3: a figure dragged from the file tree is inserted: files dropped on a grid cell, a structure row or the stage go through the
// dropImage port and insertFigure (insertSourceElement's figure, one apply); a refused drop, plain text or a workspace without the port
// changes nothing. Acceptance ids: 7.3a, 7.3b, 7.3c, A7.
import { insertSourceElement, readSourceDeckBlocks, type SourceDeckNode } from "../../../../src/decks/index.js";
import { flush, mount, type Rig } from "./workspaceHarness";

const openPdfDeck = jest.fn();
jest.mock("../../../../src/decks/dom/pdfDeck", () => ({ ...jest.requireActual("../../../../src/decks/dom/pdfDeck"), openPdfDeck: (...args: unknown[]) => openPdfDeck(...args) }));

const TALK = [
  "% labshelf: talk", "\\documentclass{beamer}", "\\begin{document}",
  "\\begin{frame}{One}", "  Hello", "\\end{frame}",
  "\\begin{frame}{Two}", "  \\begin{itemize}", "    \\item A", "  \\end{itemize}", "\\end{frame}",
  "\\end{document}", "",
].join("\n");
const SRC = "../figures/plot.png";
const URIS = { "text/uri-list": "file:///proj/figures/plot.png" };

const dragEvent = (type: string, data: Record<string, string>): MouseEvent => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types: Object.keys(data), getData: (t: string) => data[t] ?? "", dropEffect: "none" } });
  return event;
};
const figure = (format: "latex", text: string, target: Pick<SourceDeckNode, "range" | "bodyRange" | "children">): string => insertSourceElement(format, text, target, "figure", SRC)!.text;

function rig(text: string, path: string, options: Parameters<typeof mount>[2] = {}): { rig: Rig; drops: unknown[] } {
  const drops: unknown[] = [];
  const answer = options.dropImage;
  const made = mount(path, text, { ...options, ...(answer === undefined && !("dropImage" in options) ? { dropImage: async (drop) => { drops.push(drop); return SRC; } } : {}) });
  return { rig: made, drops };
}

const talkTree = readSourceDeckBlocks("latex", "talk", TALK);
const slideIndexes = talkTree.flatMap((node, index) => (node.kind === "slide" ? [index] : []));

describe("dropping on a grid cell", () => {
  it("7.3a inserts \\includegraphics with the port's path into that slide, as one apply", async () => {
    const { rig: r, drops } = rig(TALK, "talks/demo/main.tex", { mode: "grid" });
    await flush();
    const cell = r.root.querySelectorAll<HTMLElement>(".dsh-grid-cell")[1]!;
    const over = dragEvent("dragover", URIS);
    cell.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    cell.dispatchEvent(dragEvent("drop", URIS));
    await flush();
    expect(drops).toEqual([{ uris: ["file:///proj/figures/plot.png"], files: [] }]);
    expect(r.applied).toEqual([figure("latex", TALK, talkTree[slideIndexes[1]!]!)]);
    expect(r.applied[0]).toContain(`\\includegraphics[width=0.8\\linewidth]{${SRC}}`);
  });

  it("7.3a a drop the port refuses changes nothing", async () => {
    const { rig: r } = rig(TALK, "talks/demo/main.tex", { mode: "grid", dropImage: async () => undefined });
    await flush();
    r.root.querySelectorAll<HTMLElement>(".dsh-grid-cell")[0]!.dispatchEvent(dragEvent("drop", URIS));
    await flush();
    expect(r.applied).toEqual([]);
    expect(r.text()).toBe(TALK);
  });
});

describe("dropping on the structure panel", () => {
  it("7.3a a talk's slide thumbnail takes the figure into that slide", async () => {
    const { rig: r } = rig(TALK, "talks/demo/main.tex");
    await flush();
    r.root.querySelectorAll<HTMLElement>('[aria-label="Slides"] .dw-thumb')[0]!.dispatchEvent(dragEvent("drop", URIS));
    await flush();
    expect(r.applied).toEqual([figure("latex", TALK, talkTree[slideIndexes[0]!]!)]);
  });
});

describe("dropping on the stage", () => {
  beforeEach(() => {
    openPdfDeck.mockReset();
    openPdfDeck.mockImplementation(async () => ({ count: 1, labels: null, pageSize: () => ({ width: 480, height: 270 }), render: async () => undefined, textRuns: async () => [], destroy: () => undefined }));
  });

  it("7.3b targets the slide the build's page map names for the page", async () => {
    const second = talkTree[slideIndexes[1]!]!;
    const pageMap = { pages: [{ file: "main.tex", line: second.line, kind: "frame" as const }], blocks: [] };
    const { rig: r } = rig(TALK, "talks/demo/main.tex", { pageMap, pdf: true });
    await flush();
    r.root.querySelector<HTMLElement>(".dw-stage")!.dispatchEvent(dragEvent("drop", URIS));
    await flush();
    expect(r.applied).toEqual([figure("latex", TALK, second)]);
  });

  it("7.3b without a slide for the page the current slide takes it", async () => {
    const { rig: r } = rig(TALK, "talks/demo/main.tex");
    await flush();
    r.root.querySelector<HTMLElement>(".dw-stage")!.dispatchEvent(dragEvent("drop", URIS));
    await flush();
    expect(r.applied).toEqual([figure("latex", TALK, talkTree[slideIndexes[0]!]!)]);
  });
});

describe("drags the workspace does not take", () => {
  it("7.3c plain text is not accepted on the stage, a cell or a row", async () => {
    const { rig: r, drops } = rig(TALK, "talks/demo/main.tex", { mode: "grid" });
    await flush();
    for (const target of [r.root.querySelector(".dw-stage")!, r.root.querySelector(".dsh-grid-cell")!, r.root.querySelector(".dw-thumb")!]) {
      const over = dragEvent("dragover", { "text/plain": "hello" });
      target.dispatchEvent(over);
      expect(over.defaultPrevented).toBe(false);
      target.dispatchEvent(dragEvent("drop", { "text/plain": "hello" }));
    }
    await flush();
    expect(drops).toEqual([]);
    expect(r.applied).toEqual([]);
  });

  it("7.3c without the port no file drag is accepted", async () => {
    const r = mount("talks/demo/main.tex", TALK, { mode: "grid" });
    await flush();
    for (const target of [r.root.querySelector(".dw-stage")!, r.root.querySelector(".dsh-grid-cell")!, r.root.querySelector(".dw-thumb")!]) {
      const over = dragEvent("dragover", URIS);
      target.dispatchEvent(over);
      expect(over.defaultPrevented).toBe(false);
    }
  });
});
