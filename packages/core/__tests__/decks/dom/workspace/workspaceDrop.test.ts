/** @jest-environment jsdom */
// Spec 7.3: a figure dragged from the file tree is inserted: files dropped on a grid cell, a structure row or the stage go through the
// dropImage port and insertFigure (insertSourceElement's figure, one apply); a refused drop, plain text or a workspace without the port
// changes nothing. Acceptance ids: 7.3a, 7.3b, 7.3c, A7.
import { findSourceDeckNode, insertSourceElement, readSourceDeckBlocks, type SourceDeckNode, type SourceDeckPath } from "../../../../src/decks/index.js";
import { TIKZ, flush, mount, type Rig } from "./workspaceHarness";

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
  const posterTree = readSourceDeckBlocks("latex", "poster", TIKZ);
  const blockPath = ((): SourceDeckPath => {
    for (const [c, column] of posterTree.entries()) {
      const b = (column.children ?? []).findIndex((block) => block.kind === "block" && (block.children ?? []).some((child) => !child.children));
      if (b >= 0) return [c, b];
    }
    throw new Error("the poster fixture has no block with a leaf");
  })();

  it("7.3b a block row (a container) takes the figure at the end of its body", async () => {
    const { rig: r } = rig(TIKZ, "posters/demo/main.tex");
    await flush();
    const block = findSourceDeckNode(posterTree, blockPath)!;
    const row = [...r.root.querySelectorAll<HTMLElement>('[aria-label="Blocks"] [data-kind="block"]')].find((item) => item.title === `Line ${block.line}`)!;
    row.dispatchEvent(dragEvent("drop", URIS));
    await flush();
    expect(r.applied).toEqual([figure("latex", TIKZ, block)]);
  });

  it("7.3b an element row (a leaf) takes the figure after itself", async () => {
    const { rig: r } = rig(TIKZ, "posters/demo/main.tex");
    await flush();
    const block = findSourceDeckNode(posterTree, blockPath)!;
    const leafAt = block.children!.findIndex((child) => !child.children);
    const leaf = block.children![leafAt]!;
    [...r.root.querySelectorAll<HTMLElement>('[aria-label="Blocks"] [data-kind="block"]')].find((item) => item.title === `Line ${block.line}`)!.click();
    await flush();
    const row = r.root.querySelectorAll<HTMLElement>('[aria-label="Elements"] [role="treeitem"]')[leafAt]!;
    row.dispatchEvent(dragEvent("drop", URIS));
    await flush();
    expect(r.applied).toEqual([figure("latex", TIKZ, leaf)]);
  });

  it("7.3a a talk's slide thumbnail takes the figure into that slide", async () => {
    const { rig: r } = rig(TALK, "talks/demo/main.tex");
    await flush();
    r.root.querySelectorAll<HTMLElement>('[aria-label="Slides"] .dw-thumb')[0]!.dispatchEvent(dragEvent("drop", URIS));
    await flush();
    expect(r.applied).toEqual([figure("latex", TALK, talkTree[slideIndexes[0]!]!)]);
  });
});

describe("dropping on the stage", () => {
  const list = findSourceDeckNode(talkTree, [slideIndexes[1]!, 0])!;

  it("7.3b targets the node under the point by the click's hit test", async () => {
    const links = { boxes: async () => [], sourceAt: async () => list.line };
    const { rig: r } = rig(TALK, "talks/demo/main.tex", { links });
    await flush();
    r.root.querySelector<HTMLElement>(".dw-stage")!.dispatchEvent(dragEvent("drop", URIS));
    await flush();
    expect(r.applied).toEqual([figure("latex", TALK, list)]);
  });

  it("7.3b without a node under the point the current slide takes it", async () => {
    const links = { boxes: async () => [], sourceAt: async () => null };
    const { rig: r } = rig(TALK, "talks/demo/main.tex", { links });
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
