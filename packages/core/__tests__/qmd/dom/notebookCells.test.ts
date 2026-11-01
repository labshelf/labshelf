/** @jest-environment jsdom */
/**
 * Tests the notebook cells of one editor view: notebookCells lists the code cells in document order with language, key and section
 * keys; run() resolves at the end state the fake host posts; setQueue shows Queued and Not run on the cell line and clears them.
 *
 * The fake host is a createCellRunGroup row attached to the element the view is mounted in, as a real host does: the cells' Run goes
 * through the row to `send`, and the test then posts the states with group.show, as the host's cellState messages do.
 *
 * The run status row's 'Running k of n' and Stop (2.2c) are tested in runProgress.test.ts.
 */
import type { EditorView } from "prosemirror-view";
import type { Node as PmNode } from "prosemirror-model";
import { notebookCells, sectionKey } from "../../../src/qmd/dom/notebookCells";
import type { CellRunEnd, NotebookCell } from "../../../src/qmd/noteRuns";
import { createCellRunGroup } from "../../../src/qmd/dom/cellRunStatus";
import { createCodeCellView } from "../../../src/qmd/dom/codeCellView";
import { bodyToDoc } from "../../../src/qmd/editor";
import { mount, settle } from "../../support/nodeViewHarness";

// jsdom has no layout; CodeMirror measures text ranges.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const ITEM = "item-1";
const cellBody = (lang: string, code: string, label?: string): string => `\`\`\`{${lang}}\n${label ? `#| label: ${label}\n` : ""}${code}\n\`\`\`\n`;

interface Sent { label: string; code: string; requestId: string; language: string }
interface Fixture { view: EditorView; cells: readonly NotebookCell[]; sent: Sent[]; post(index: number, state: "running" | "done" | "error" | "cancelled" | "missing"): void }

function setup(body: string, opts: { runner?: boolean } = {}): Fixture {
  const sent: Sent[] = [];
  const group = createCellRunGroup({ onCancel: () => undefined });
  let run: ((label: string, code: string, language: never) => void) | undefined;
  const doc: PmNode = bodyToDoc(body);
  const view = mount(doc, { code_cell: createCodeCellView(opts.runner === false ? undefined : (label, code, language) => run?.(label, code, language as never)) });
  const send = (label: string, code: string, requestId: string, language: string): void => { sent.push({ label, code, requestId, language }); };
  run = group.attach(ITEM, view.dom.parentElement!, send as never) as never;
  return {
    view,
    cells: notebookCells(view, ITEM),
    sent,
    post(index, state) {
      const requestId = sent[index]!.requestId;
      // The host sends run info with done and error, none with cancelled or missing.
      const info = state === "done" || state === "error" ? { durationMs: 5 } : undefined;
      group.show(requestId, state, info as never);
    },
  };
}

const lines = (view: EditorView): HTMLElement[] => [...view.dom.querySelectorAll<HTMLElement>(".qmd-cell")];
const pending = <T>(promise: Promise<T>): { done: boolean } => {
  const state = { done: false };
  void promise.then(() => { state.done = true; }, () => { state.done = true; });
  return state;
};

describe("sectionKey", () => {
  it("2.2a formats the key as level:text:occurrence", () => {
    expect(sectionKey(2, "Intro", 0)).toBe("2:Intro:0");
    expect(sectionKey(1, "Results and more", 3)).toBe("1:Results and more:3");
  });
});

describe("notebookCells lists", () => {
  const BODY = [
    cellBody("python", "a = 1", "first"),
    "# Top\n\n",
    cellBody("r", "x <- 1", "second"),
    "## Sub\n\n",
    cellBody("mathematica", "1 + 1"),
    "## Other\n\n",
    cellBody("python", "b = 2", "fourth"),
  ].join("\n");

  it("2.2a the code cells in document order with their language", () => {
    const { cells } = setup(BODY);
    expect(cells.map((c) => c.language)).toEqual(["python", "r", "mathematica", "python"]);
  });

  it("2.2a every cell carries the item id it was asked for", () => {
    const { cells } = setup(BODY);
    expect(cells.map((c) => c.itemId)).toEqual([ITEM, ITEM, ITEM, ITEM]);
  });

  it("2.2a a labelled cell's key is itemId#label", () => {
    const { cells } = setup(BODY);
    expect([cells[0]!.key, cells[1]!.key, cells[3]!.key]).toEqual([`${ITEM}#first`, `${ITEM}#second`, `${ITEM}#fourth`]);
  });

  it("2.2a an unlabelled cell's key is itemId#ordinal, counting every cell of the item", () => {
    const { cells } = setup(BODY);
    expect(cells[2]!.key).toMatch(new RegExp(`^${ITEM}#(cell-)?3$`));
  });

  it("2.2a the keys of the cells are all different", () => {
    const { cells } = setup(BODY);
    expect(new Set(cells.map((c) => c.key)).size).toBe(4);
  });

  it("2.2a a cell before any heading has no section keys", () => {
    const { cells } = setup(BODY);
    expect(cells[0]!.sectionKeys).toEqual([]);
  });

  it("2.2a a cell's section keys name every heading whose section contains it, outermost first", () => {
    const { cells } = setup(BODY);
    expect(cells[1]!.sectionKeys).toHaveLength(1);
    expect(cells[1]!.sectionKeys[0]).toMatch(/^1:Top:[01]$/);
    expect(cells[2]!.sectionKeys).toHaveLength(2);
    expect(cells[2]!.sectionKeys[0]).toBe(cells[1]!.sectionKeys[0]);
    expect(cells[2]!.sectionKeys[1]).toMatch(/^2:Sub:[01]$/);
  });

  it("2.2a a heading of the same level ends the earlier section for the cells after it", () => {
    const { cells } = setup(BODY);
    expect(cells[3]!.sectionKeys).toHaveLength(2);
    expect(cells[3]!.sectionKeys[0]).toBe(cells[1]!.sectionKeys[0]);
    expect(cells[3]!.sectionKeys[1]).toMatch(/^2:Other:[01]$/);
    expect(cells[3]!.sectionKeys).not.toContain(cells[2]!.sectionKeys[1]);
  });

  it("2.2a two headings with the same level and text get different keys, in order", () => {
    const body = ["## Same\n\n", cellBody("python", "a", "one"), "## Same\n\n", cellBody("python", "b", "two")].join("\n");
    const { cells } = setup(body);
    const first = cells[0]!.sectionKeys[0]!;
    const second = cells[1]!.sectionKeys[0]!;
    expect(first).toMatch(/^2:Same:[01]$/);
    expect(second).toBe(sectionKey(2, "Same", Number(first.split(":").pop()) + 1));
  });

  it("2.2a a note without code cells lists nothing", () => {
    const { cells } = setup("# Only prose\n\nSome text.\n");
    expect(cells).toEqual([]);
  });

  it("2.2a reads the document again on each call", () => {
    const { view } = setup(BODY);
    const again = notebookCells(view, ITEM);
    expect(again.map((c) => c.language)).toEqual(["python", "r", "mathematica", "python"]);
    const tr = view.state.tr.delete(0, view.state.doc.child(0).nodeSize);
    view.dispatch(tr);
    expect(notebookCells(view, ITEM).map((c) => c.language)).toEqual(["r", "mathematica", "python"]);
  });
});

describe("NotebookCell.run resolves at the end state", () => {
  const BODY = [cellBody("python", "a = 1", "one"), cellBody("python", "b = 2", "two")].join("\n");

  it("2.2a resolves 'ok' when the fake host posts done", async () => {
    const t = setup(BODY);
    const result = t.cells[0]!.run();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({ label: "one", code: "a = 1\n", language: "python" });
    t.post(0, "running");
    t.post(0, "done");
    await expect(result).resolves.toBe<CellRunEnd>("ok");
  });

  it("2.2a resolves 'error' when the fake host posts error", async () => {
    const t = setup(BODY);
    const result = t.cells[1]!.run();
    expect(t.sent[0]).toMatchObject({ label: "two" });
    t.post(0, "running");
    t.post(0, "error");
    await expect(result).resolves.toBe<CellRunEnd>("error");
  });

  it("2.2a resolves 'cancelled' when the fake host posts cancelled", async () => {
    const t = setup(BODY);
    const result = t.cells[0]!.run();
    t.post(0, "running");
    t.post(0, "cancelled");
    await expect(result).resolves.toBe<CellRunEnd>("cancelled");
  });

  it("2.2a resolves 'missing' when the fake host posts missing", async () => {
    const t = setup(BODY);
    const result = t.cells[0]!.run();
    t.post(0, "missing");
    await expect(result).resolves.toBe<CellRunEnd>("missing");
  });

  it("2.2a does not resolve while the host only says running", async () => {
    const t = setup(BODY);
    const state = pending(t.cells[0]!.run());
    t.post(0, "running");
    await settle(30);
    expect(state.done).toBe(false);
    t.post(0, "done");
    await settle(10);
    expect(state.done).toBe(true);
  });

  it("2.2a resolves 'missing' when the row refuses the run because another is in flight", async () => {
    const t = setup(BODY);
    const first = t.cells[0]!.run();
    t.post(0, "running");
    await expect(t.cells[1]!.run()).resolves.toBe<CellRunEnd>("missing");
    expect(t.sent).toHaveLength(1);
    t.post(0, "done");
    await expect(first).resolves.toBe<CellRunEnd>("ok");
  });

  it("2.2a resolves 'missing' without posting when the view has no runner", async () => {
    const t = setup(BODY, { runner: false });
    await expect(t.cells[0]!.run()).resolves.toBe<CellRunEnd>("missing");
    expect(t.sent).toEqual([]);
  });
});

describe("NotebookCell.setQueue", () => {
  const BODY = [cellBody("python", "a = 1", "one"), cellBody("python", "b = 2", "two")].join("\n");
  const NOT_RUN = "Not run: stopped at an error above";

  it("2.2b 'queued' puts Queued on that cell's line and not on the others", () => {
    const t = setup(BODY);
    t.cells[0]!.setQueue("queued");
    const [first, second] = lines(t.view);
    expect(first!.textContent).toContain("Queued");
    expect(second!.textContent).not.toContain("Queued");
  });

  it("2.2b 'queued' marks the cell with is-queued", () => {
    const t = setup(BODY);
    t.cells[1]!.setQueue("queued");
    const second = lines(t.view)[1]!;
    expect(second.classList.contains("is-queued")).toBe(true);
    expect(lines(t.view)[0]!.classList.contains("is-queued")).toBe(false);
  });

  it("2.2b 'not-run' shows the Not run text on that cell's line", () => {
    const t = setup(BODY);
    t.cells[1]!.setQueue("not-run");
    const [first, second] = lines(t.view);
    expect(second!.textContent).toContain(NOT_RUN);
    expect(second!.classList.contains("is-not-run")).toBe(true);
    expect(first!.textContent).not.toContain("Not run");
    expect(second!.textContent).not.toContain("Queued");
  });

  it("2.2b 'queued' then 'not-run' replaces Queued", () => {
    const t = setup(BODY);
    t.cells[0]!.setQueue("queued");
    t.cells[0]!.setQueue("not-run");
    const first = lines(t.view)[0]!;
    expect(first.textContent).toContain(NOT_RUN);
    expect(first.textContent).not.toContain("Queued");
    expect(first.classList.contains("is-queued")).toBe(false);
  });

  it("2.2b null clears Queued", () => {
    const t = setup(BODY);
    t.cells[0]!.setQueue("queued");
    t.cells[0]!.setQueue(null);
    const first = lines(t.view)[0]!;
    expect(first.textContent).not.toContain("Queued");
    expect(first.classList.contains("is-queued")).toBe(false);
  });

  it("2.2b null clears Not run", () => {
    const t = setup(BODY);
    t.cells[0]!.setQueue("not-run");
    t.cells[0]!.setQueue(null);
    const first = lines(t.view)[0]!;
    expect(first.textContent).not.toContain("Not run");
    expect(first.classList.contains("is-not-run")).toBe(false);
  });

  it("2.2b a run of the cell clears Queued", () => {
    const t = setup(BODY);
    t.cells[0]!.setQueue("queued");
    void t.cells[0]!.run();
    expect(lines(t.view)[0]!.textContent).not.toContain("Queued");
    expect(lines(t.view)[0]!.classList.contains("is-queued")).toBe(false);
  });

  it("2.2b an edit of the cell's code clears Not run", () => {
    const t = setup(BODY);
    t.cells[0]!.setQueue("not-run");
    expect(lines(t.view)[0]!.textContent).toContain(NOT_RUN);
    const node = t.view.state.doc.child(0);
    t.view.dispatch(t.view.state.tr.setNodeMarkup(0, undefined, { ...node.attrs, code: "a = 2\n" }));
    expect(lines(t.view)[0]!.textContent).not.toContain("Not run");
  });

  it("A3 a queued cell shows Queued, then the existing running state once its run is under way, without Queued", () => {
    const t = setup(BODY);
    t.cells[0]!.setQueue("queued");
    t.cells[1]!.setQueue("queued");
    expect(lines(t.view).map((l) => l.textContent?.includes("Queued"))).toEqual([true, true]);
    t.cells[0]!.setQueue(null);
    void t.cells[0]!.run();
    t.post(0, "running");
    const [first, second] = lines(t.view);
    expect(first!.classList.contains("is-running")).toBe(true);
    expect(first!.textContent).not.toContain("Queued");
    expect(second!.textContent).toContain("Queued");
    expect(second!.classList.contains("is-running")).toBe(false);
  });
});
