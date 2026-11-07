/** @jest-environment jsdom */
// Clicking a block on the rendered page of a LaTeX talk or poster must select the block clicked. Pure linking level (createLinking over a fake
// PdfDeck, fake SyncTeX links and synthetic text-layer runs), plus the async pick()/drawOutlines() of the workspace view and the workspace edits.
// Acceptance ids: A1 = a click selects the node under the pointer and outlines follow the selection; A3 = builds and thrown edits never freeze or blank the editor.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { matchTextRects, readSourceDeckBlocks, type SourceDeckRect } from "../../../../src/decks/index.js";
import type { PdfDeck } from "../../../../src/decks/dom/pdfDeck";
import { createLinking } from "../../../../src/decks/dom/workspace/linking";
import type { DeckBuildState, DeckSourceLinks } from "../../../../src/decks/dom/workspace/types";
import { apply } from "../../../../src/decks/dom/workspace/workspaceEdits";
import { buildStateChanged, drawOutlines, pick, select, textChanged } from "../../../../src/decks/dom/workspace/workspaceView";
import type { WorkspaceState } from "../../../../src/decks/dom/workspace/workspaceState";

const fixture = (name: string): string => readFileSync(join(__dirname, "..", "..", "fixtures", name), "utf8");
const run = (text: string, left: number, top: number, width = 200, pt = 20) => ({ text, left, top, width, pt });
type Run = ReturnType<typeof run>;
const rect = (page: number, left: number, top: number, right: number, bottom: number): SourceDeckRect => ({ page, left, top, right, bottom });
const A1 = { width: 2384, height: 1684 };
const SLIDE = { width: 960, height: 540 };
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await tick(); };

/** A PDF with one list of text runs per page; a flat list is a one-page PDF. */
function fakePdf(pages: Run[] | Run[][], size = A1): PdfDeck {
  const lists: Run[][] = pages.length > 0 && Array.isArray(pages[0]) ? (pages as Run[][]) : [pages as Run[]];
  return { count: lists.length, labels: null, pageSize: () => size, render: async () => undefined, textRuns: async (page: number) => lists[page] ?? [], destroy: () => undefined };
}

describe("matchTextRects: a phrase repeated in two elements", () => {
  it("A1 gives each element the runs next to its own distinctive words, not both to the first", () => {
    const runs = [run("The signal is", 100, 100), run("sparse", 100, 130, 60), run("The signal is", 100, 400), run("dense", 100, 430, 60)];
    const rects = matchTextRects([{ key: "a", words: "The signal is sparse" }, { key: "b", words: "The signal is dense" }], runs, 1);
    expect(rects.get("a")!.bottom).toBeLessThan(300);
    expect(rects.get("b")!.top).toBeLessThan(410);
  });

  it("A1 does not stretch the first element over the second one's copy of the phrase", () => {
    const runs = [run("Shared opening line", 100, 100), run("alpha tail", 100, 130, 100), run("Shared opening line", 100, 600), run("omega tail", 100, 630, 100)];
    const rects = matchTextRects([{ key: "a", words: "Shared opening line alpha tail" }, { key: "b", words: "Shared opening line omega tail" }], runs, 1);
    expect(rects.get("a")!.bottom).toBeLessThan(400);
    expect(rects.get("b")!.top).toBeGreaterThan(400);
  });
});

describe("a poster click when SyncTeX names the line of the NEXT block", () => {
  // tikzposter/beamer tag a block's content with the line of the token that ended it (the next \block or \column), so the line is the next node's.
  const text = fixture("a1-tikz.tex");
  const tree = readSourceDeckBlocks("latex", "poster", text);
  // Left column: Introduction (lines 17-19) above Method (20-22). The click is in Introduction's body.
  const titleRuns = [run("Introduction", 100, 200), run("Method", 100, 600), run("Results", 1300, 200), run("Conclusion", 1300, 600)];
  const body = [run("What the problem is and why it matters.", 100, 260, 700, 20), run("More text of the column", 100, 900, 700, 20)];
  const links: DeckSourceLinks = {
    sourceAt: async () => 20,
    boxes: async (from) => (from === 20 ? [rect(1, 90, 590, 900, 1000)] : from === 17 ? [rect(1, 90, 190, 900, 330)] : []),
  };

  it("A1 selects the block under the point, not the one SyncTeX names", async () => {
    const linking = createLinking("latex", "poster", links);
    await linking.reset(fakePdf([...titleRuns, ...body]), tree, text);
    const path = await linking.pathAt({ page: 1, x: 300, y: 270 }, tree, (node) => node.kind === "block");
    expect(path).toEqual([0, 0]);
  });

  it("A1 still selects the block SyncTeX names when the point is inside that block's own rectangle", async () => {
    const linking = createLinking("latex", "poster", links);
    await linking.reset(fakePdf([...titleRuns, ...body]), tree, text);
    expect(await linking.pathAt({ page: 1, x: 300, y: 950 }, tree, (node) => node.kind === "block")).toEqual([0, 1]);
  });

  it("A1 selects the block under the point when SyncTeX has no answer there", async () => {
    const linking = createLinking("latex", "poster", { sourceAt: async () => undefined, boxes: async () => null });
    await linking.reset(fakePdf([...titleRuns, ...body]), tree, text);
    expect(await linking.pathAt({ page: 1, x: 300, y: 270 }, tree, (node) => node.kind === "block")).toEqual([0, 0]);
  });
});

describe("a beamer click when SyncTeX names the following \\column or \\end line", () => {
  // defesa-beamer.tex, slide 3 "Results": \begin{columns} 29, \column 30 + text 31, \column 32 + equation 33, \end{columns} 34. Paragraph "A figure goes here." is line 31.
  const text = fixture("defesa-beamer.tex");
  const tree = readSourceDeckBlocks("latex", "talk", text);
  const pages = [[], [], [run("A figure goes here.", 100, 300, 420, 24)], []];
  // SyncTeX boxes for the second column's lines cover the right half only.
  const rightColumn = [rect(3, 520, 280, 900, 400)];
  const linksFor = (line: number): DeckSourceLinks => ({ sourceAt: async () => line, boxes: async (from) => (from >= 32 && from <= 34 ? rightColumn : []) });
  const accept = (): boolean => true;

  async function clickWithTag(line: number, x: number, y: number) {
    const linking = createLinking("latex", "talk", linksFor(line));
    await linking.reset(fakePdf(pages, SLIDE), tree, text);
    return linking.pathAt({ page: 3, x, y }, tree, accept);
  }

  it("A1 selects the paragraph tagged with the following \\column line", async () => {
    expect(await clickWithTag(32, 200, 310)).toEqual([2, 0, 0, 0]);
  });

  it("A1 selects the paragraph tagged with the \\end{columns} line", async () => {
    expect(await clickWithTag(34, 200, 310)).toEqual([2, 0, 0, 0]);
  });

  it("A1 selects the paragraph when SyncTeX names the paragraph's own line", async () => {
    expect(await clickWithTag(31, 200, 310)).toEqual([2, 0, 0, 0]);
  });
});

describe("existing behaviour of the click", () => {
  it("A1 finds a Typst poster's blocks by their titles when there are no source links", async () => {
    const text = fixture("typst-a0.typ");
    const tree = readSourceDeckBlocks("typst", "poster", text);
    const titles = [run("Introduction", 100, 200), run("Method", 100, 600), run("Results", 1300, 200), run("Conclusion", 1300, 600)];
    const body = [run("What the problem is and why it matters.", 100, 260, 700), run("A figure goes here.", 1300, 260, 700), run("More text of the column", 100, 900, 700)];
    const linking = createLinking("typst", "poster", undefined);
    await linking.reset(fakePdf([...titles, ...body]), tree, text);
    const accept = (node: { kind: string }): boolean => node.kind === "block";
    expect(await linking.pathAt({ page: 1, x: 300, y: 270 }, tree, accept as never)).toEqual([0, 0]);
    expect(await linking.pathAt({ page: 1, x: 1400, y: 270 }, tree, accept as never)).toEqual([1, 0]);
    expect(await linking.pathAt({ page: 1, x: 300, y: 700 }, tree, accept as never)).toEqual([0, 1]);
  });
});

describe("rectangles after an edit that moved the nodes", () => {
  const text = fixture("a1-tikz.tex");
  const isBlock = (n: { kind: string }): boolean => n.kind === "block";
  async function linkedOn(source: string) {
    const tree = readSourceDeckBlocks("latex", "poster", source);
    const linking = createLinking("latex", "poster", undefined);
    await linking.reset(fakePdf([run("Introduction", 100, 200), run("Method", 100, 600)]), tree, source);
    expect(await linking.pathAt({ page: 1, x: 300, y: 250 }, tree, isBlock as never)).toEqual([0, 0]);
    return linking;
  }

  it("A1 forget() drops the text-layer rectangles too, so a click is not matched against paths of the old tree (insert)", async () => {
    const linking = await linkedOn(text);
    // A block is inserted above Introduction in the editor; the PDF is still the old build.
    const edited = text.replace("  \\block{Introduction}", "  \\block{New}{\n    Fresh.\n  }\n  \\block{Introduction}");
    linking.forget();
    // Old path [0,0] is now "New"; the old rectangle must not select it.
    expect(await linking.pathAt({ page: 1, x: 300, y: 250 }, readSourceDeckBlocks("latex", "poster", edited), isBlock as never)).not.toEqual([0, 0]);
  });

  it("A1 does not match a click against the old paths after a block is deleted", async () => {
    const linking = await linkedOn(text);
    const edited = text.replace(/  \\block\{Introduction\}\{\n[^\n]*\n  \}\n/, "");
    expect(readSourceDeckBlocks("latex", "poster", edited)[0]!.children).toHaveLength(1);
    linking.forget();
    // [0,0] is Method now; the rectangle that was Introduction's must not select it.
    expect(await linking.pathAt({ page: 1, x: 300, y: 250 }, readSourceDeckBlocks("latex", "poster", edited), isBlock as never)).not.toEqual([0, 0]);
  });

  it("A1 does not match a click against the old paths after a block is moved", async () => {
    const linking = await linkedOn(text);
    const edited = text.replace("  \\block{Introduction}{\n    What the problem is and why it matters.\n  }\n  \\block{Method}{\n    \\[ \\min_{x} \\|Ax - b\\|_2^2 \\]\n  }\n",
      "  \\block{Method}{\n    \\[ \\min_{x} \\|Ax - b\\|_2^2 \\]\n  }\n  \\block{Introduction}{\n    What the problem is and why it matters.\n  }\n");
    expect(edited).not.toBe(text);
    linking.forget();
    expect(await linking.pathAt({ page: 1, x: 300, y: 250 }, readSourceDeckBlocks("latex", "poster", edited), isBlock as never)).not.toEqual([0, 0]);
  });
});

// ---- the workspace view: a state object with just enough around it for pick(), select(), drawOutlines(), buildStateChanged(), textChanged() and apply() ----

interface Probe {
  ws: WorkspaceState;
  outlines: unknown[][];
  /** The rects of the last setOutlines call. */
  last(): SourceDeckRect[];
}

interface ProbeOptions {
  kind?: "poster" | "talk";
  selected?: number[];
  pathAt?: (point: { page: number; x: number; y: number }, accept: (node: never) => boolean) => Promise<number[]>;
  rectOf?: (path: number[]) => Promise<SourceDeckRect | undefined>;
  pdf?: PdfDeck;
  editing?: Partial<WorkspaceState["ports"]["editing"]>;
}

function probe(options: ProbeOptions = {}): Probe {
  const kind = options.kind ?? "poster";
  const format = "latex";
  const text = fixture(kind === "poster" ? "a1-tikz.tex" : "defesa-beamer.tex");
  const outlines: unknown[][] = [];
  const rectOf = options.rectOf ?? (async (path: number[]): Promise<SourceDeckRect> => rect(1, path[1] ?? 0, 0, (path[1] ?? 0) + 1, 1));
  const pdf = options.pdf ?? fakePdf([]);
  const noop = new Proxy(function () { /* stub */ }, { get: () => noop, apply: () => undefined }) as never;
  const ws = {
    kind, format, text, tree: readSourceDeckBlocks(format, kind, text), selected: options.selected ?? [0], mode: "visual", sync: false, ownEdit: false, name: "deck",
    build: { state: "succeeded", errors: 0 } as DeckBuildState, flashTimer: undefined, buildSoon: { call: () => undefined, cancel: () => undefined },
    linking: {
      pathAt: (point: { page: number; x: number; y: number }, _tree: unknown, accept: (node: never) => boolean) => (options.pathAt ?? (async () => []))(point, accept),
      rectOf: (path: number[]) => rectOf(path), linked: () => true, note: () => "", slideOfPage: (page: number) => page - 1, pageOfSlide: (slide: number) => slide + 1,
      forget: () => undefined, reset: async () => undefined,
    },
    ports: {
      editing: { text: () => text, cursor: () => 0, apply: () => undefined, reveal: () => undefined, select: () => undefined, ...options.editing },
      mode: { read: () => "visual", write: () => undefined }, build: { run: () => undefined, onState: () => () => undefined },
    },
    ui: {
      root: document.createElement("div"),
      stage: {
        guides: () => false, showPage: () => undefined, setOutlines: (o: Array<unknown>) => outlines.push([...o]), placeBar: () => undefined, setNote: () => undefined, setEmpty: () => undefined,
        pdf: () => pdf, load: async () => true,
      },
      header: noop, structure: noop, props: noop, notes: noop, insertBar: noop, status: noop, actionBar: noop,
    },
  } as unknown as WorkspaceState;
  const rectOfOutline = (o: unknown): SourceDeckRect => (o as { rect: SourceDeckRect }).rect;
  return { ws, outlines, last: () => (outlines.at(-1) ?? []).map(rectOfOutline) };
}

/** Asks `accept` about a text node: only the poster's inner-element lookup accepts it. */
const insideAccepted = (accept: (node: never) => boolean): boolean => accept({ kind: "text" } as never);

describe("pick(): overlapping async picks", () => {
  const ofX = (answers: Record<number, Promise<number[]>>) => (point: { x: number }) => answers[point.x]!;

  it("A1 keeps the last click's block when an earlier click's answer arrives later", async () => {
    let release!: (path: number[]) => void;
    const slow = new Promise<number[]>((resolve) => { release = resolve; });
    const { ws, last } = probe({ pathAt: async (point) => ofX({ 1: slow, 2: Promise.resolve([0, 1]) })(point) });
    const first = pick(ws, { page: 1, x: 1, y: 0 });   // SyncTeX answers late: block 0
    const second = pick(ws, { page: 1, x: 2, y: 0 });  // answers at once: block 1, the click made last
    await second;
    release([0, 0]);
    await first;
    await flush();
    expect(ws.selected).toEqual([0, 1]);
    // The drawn outline follows the selection, whichever drawOutlines call finished last.
    expect(last().at(-1)!.left).toBe(1);
  });

  it("A1 keeps the last click's block when the last click's answer is the one that arrives later", async () => {
    let release!: (path: number[]) => void;
    const slow = new Promise<number[]>((resolve) => { release = resolve; });
    const { ws, last } = probe({ pathAt: async (point) => ofX({ 1: Promise.resolve([0, 0]), 2: slow })(point) });
    const first = pick(ws, { page: 1, x: 1, y: 0 });
    const second = pick(ws, { page: 1, x: 2, y: 0 });
    await first;
    release([0, 1]);
    await second;
    await flush();
    expect(ws.selected).toEqual([0, 1]);
    expect(last().at(-1)!.left).toBe(1);
  });

  it("A1 outlines the block of the selection when the earlier selection's rectangle resolves after the later one's", async () => {
    let release!: (value: SourceDeckRect) => void;
    const slowRect = new Promise<SourceDeckRect>((resolve) => { release = resolve; });
    const { ws, last } = probe({ rectOf: (path) => (path[1] === 0 ? slowRect : Promise.resolve(rect(1, 50, 0, 51, 1))) });
    select(ws, [0, 0]);
    select(ws, [0, 1]);
    await flush();
    release(rect(1, 10, 0, 11, 1));
    await flush();
    expect(ws.selected).toEqual([0, 1]);
    expect(last().at(-1)!.left).toBe(50);
  });

  it("A1 selects the element inside when the block under the point is already selected (poster)", async () => {
    const { ws } = probe({ selected: [0, 0], pathAt: async (_point, accept) => (insideAccepted(accept) ? [0, 0, 0] : [0, 0]) });
    await pick(ws, { page: 1, x: 5, y: 5 });
    expect(ws.selected).toEqual([0, 0, 0]);
  });

  it("A1 selects the block, not an element inside it, when another block was selected (poster)", async () => {
    const { ws } = probe({ selected: [1, 0], pathAt: async (_point, accept) => (insideAccepted(accept) ? [0, 0, 0] : [0, 0]) });
    await pick(ws, { page: 1, x: 5, y: 5 });
    expect(ws.selected).toEqual([0, 0]);
  });

  it("A1 selects the slide of the page when a talk click hits no node", async () => {
    const { ws } = probe({ kind: "talk", selected: [0], pathAt: async () => [] });
    await pick(ws, { page: 3, x: 5, y: 5 });
    expect(ws.selected).toEqual([2]);
  });
});

describe("outlines during and after builds", () => {
  const R1 = rect(1, 100, 100, 400, 300);
  const R2 = rect(1, 120, 130, 420, 330);
  const isStale = (outline: unknown): boolean => /stale/i.test(JSON.stringify(outline));

  /** A poster workspace whose selected block has the rectangle `current.rect` (undefined while the build left none). */
  function building() {
    const current: { rect: SourceDeckRect | undefined } = { rect: R1 };
    const p = probe({ selected: [0, 0], rectOf: async () => current.rect, pdf: fakePdf([]) });
    return { ...p, current };
  }

  it("A3 keeps the last good outline, marked stale, while a build runs", async () => {
    const { ws, outlines, last, current } = building();
    await drawOutlines(ws);
    expect(last()).toEqual([R1]);
    expect(isStale(outlines.at(-1))).toBe(false);
    ws.build = { state: "succeeded", errors: 0 };
    buildStateChanged(ws, { state: "building", errors: 0 });
    current.rect = undefined; // the linking was reset: nothing is placed until the new PDF is read
    await drawOutlines(ws);
    await flush();
    expect(last()).toEqual([R1]);
    expect(isStale(outlines.at(-1))).toBe(true);
  });

  it("A3 keeps the last good outline, marked stale, after a failed build", async () => {
    const { ws, outlines, last, current } = building();
    await drawOutlines(ws);
    buildStateChanged(ws, { state: "building", errors: 0 });
    current.rect = undefined;
    buildStateChanged(ws, { state: "failed", errors: 2 });
    await drawOutlines(ws);
    await flush();
    expect(last()).toEqual([R1]);
    expect(isStale(outlines.at(-1))).toBe(true);
  });

  it("A3 replaces the stale outline as soon as the rebuilt rectangle arrives", async () => {
    const { ws, outlines, last, current } = building();
    await drawOutlines(ws);
    buildStateChanged(ws, { state: "building", errors: 0 });
    current.rect = undefined;
    await drawOutlines(ws);
    current.rect = R2;
    buildStateChanged(ws, { state: "succeeded", errors: 0 });
    await flush();
    await drawOutlines(ws);
    expect(last()).toEqual([R2]);
    expect(isStale(outlines.at(-1))).toBe(false);
  });

  it("A3 shows no outline at all when no build ever placed the selection", async () => {
    const { ws, outlines, current } = building();
    current.rect = undefined;
    buildStateChanged(ws, { state: "building", errors: 0 });
    await drawOutlines(ws);
    expect(outlines.at(-1) ?? []).toEqual([]);
  });
});

describe("workspace edits", () => {
  const edit = (text: string) => ({ text: `${text}\n% edited`, cursor: 0 });

  it("A3 a throwing editing.apply does not leave ownEdit set", () => {
    const text = fixture("a1-tikz.tex");
    const { ws } = probe({ editing: { apply: () => { throw new Error("editor closed"); } } });
    try { apply(ws, edit(text)); } catch { /* the failure itself may surface; the flag must not stick */ }
    expect(ws.ownEdit).toBe(false);
  });

  it("A3 the workspace reads the editor's text changes after an edit threw", () => {
    const text = fixture("a1-tikz.tex");
    let current = text;
    const { ws } = probe({ editing: { text: () => current, apply: () => { throw new Error("editor closed"); } } });
    try { apply(ws, edit(text)); } catch { /* see above */ }
    current = text.replace("Introduction", "Overview");
    textChanged(ws);
    expect(ws.text).toBe(current);
    expect(ws.tree[0]!.children![0]!.title).toBe("Overview");
  });

  it("A3 a successful edit leaves ownEdit clear and reads the new text", () => {
    const text = fixture("a1-tikz.tex");
    let current = text;
    const { ws } = probe({ editing: { text: () => current, apply: (change) => { current = change.text; } } });
    expect(apply(ws, edit(text))).toBe(true);
    expect(ws.ownEdit).toBe(false);
    expect(ws.text).toBe(current);
  });
});
