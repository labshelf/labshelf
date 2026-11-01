/** @jest-environment jsdom */
// Tests the reader's Notes tab note bar (plan notebook-flow D10, D5): the open note shows `.qmd-note-bar` in the editor nav, its Run all
// button runs that item's cells through ctx.host, and the optional 5th constructor argument is the view-state port of the editor.
//
// Assumptions: the bar is found by `.qmd-note-bar` and its Run all button by aria-label "Run all" (4.1's decided DOM); a code cell is run
// by the real editor when the host answers its runCell request with a `done` cell state.
import { TextEncoder as NodeTextEncoder } from "node:util";
import { NotesTab } from "../../src/reader/dom/notesTab";
import type { ReaderNote } from "../../src/reader/protocol/messages";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Turns any failure into "not implemented: ..." so a red run shows the behaviour is absent; the original message is kept. */
const behaviour = (body: () => Promise<void>) => async (): Promise<void> => {
  try {
    await body();
  } catch (error) {
    throw new Error(`not implemented: note bar in this host (${error instanceof Error ? error.message : String(error)})`);
  }
};

const TWO_CELLS = "Intro\n\n```{python}\n#| label: first\nprint(1)\n```\n\n```{python}\n#| label: second\nprint(2)\n```\n";
const OTHER = "```{python}\n#| label: other\nprint(3)\n```\n";
const note = (id: string, body: string): ReaderNote => ({ id, anchor: "p2 box 0.1 0.2 0.3 0.4", body, created: "2026-10-01T00:00:00.000Z", author: "Ana" }) as ReaderNote;

type TabCtor = new (...args: unknown[]) => NotesTab;

function setup(options: { canRun?: boolean; viewState?: unknown } = {}) {
  const sent: Array<Record<string, unknown>> = [];
  const host = { post: (_m: Record<string, unknown>) => undefined } as { post(m: Record<string, unknown>): void };
  const eventBus = { on: () => undefined, off: () => undefined, dispatch: () => undefined };
  document.body.replaceChildren();
  const args: unknown[] = [host, jest.fn(), () => 1, eventBus];
  if (options.viewState !== undefined) { args.push(options.viewState); }
  const tab = new (NotesTab as unknown as TabCtor)(...args);
  document.body.append(tab.el);
  host.post = (m) => {
    sent.push(m);
    if (m["command"] === "runCell" && !m["preview"]) {
      const id = String(m["requestId"]);
      setTimeout(() => tab.showCellState(id, "running"), 0);
      setTimeout(() => tab.showCellState(id, "done"), 15);
    }
  };
  tab.setCanRunCells(options.canRun ?? true);
  tab.show([note("n1", TWO_CELLS), note("n2", OTHER)]);
  const runs = () => sent.filter((m) => m["command"] === "runCell" && !m["preview"]);
  const bar = () => tab.el.querySelector<HTMLElement>(".qmd-note-bar");
  const runAll = () => bar()?.querySelector<HTMLButtonElement>('button[aria-label="Run all"]') ?? null;
  return { tab, sent, runs, bar, runAll };
}

describe("reader Notes tab note bar", () => {
  it("4.2a shows the note bar with a Run all button in the open note's nav", behaviour(async () => {
    const t = setup();
    expect(t.bar()).toBeNull();
    t.tab.reveal("n1");
    await wait(60);
    const nav = t.tab.el.querySelector(".rd-notes-editor-nav")!;
    expect(nav.querySelectorAll(".qmd-note-bar")).toHaveLength(1);
    expect(t.runAll()).not.toBeNull();
    t.tab.onHide();
  }));

  it("4.2a runs every cell of the open item in order on Run all, and no other item's", behaviour(async () => {
    const t = setup();
    t.tab.reveal("n1");
    await wait(60);
    t.runAll()!.click();
    await wait(400);
    expect(t.runs().map((m) => m["label"])).toEqual(["first", "second"]);
    expect(t.runs().every((m) => m["itemId"] === "n1")).toBe(true);
    t.tab.onHide();
  }));

  it("4.2a disables Run all when the host cannot run cells", behaviour(async () => {
    const t = setup({ canRun: false });
    t.tab.reveal("n1");
    await wait(60);
    expect(t.runAll()).not.toBeNull();
    expect(t.runAll()!.disabled).toBe(true);
    t.runAll()!.click();
    await wait(100);
    expect(t.runs()).toEqual([]);
    t.tab.onHide();
  }));

  it("4.2a removes the bar when the note is closed and shows one again for the next note", behaviour(async () => {
    const t = setup();
    t.tab.reveal("n1");
    await wait(60);
    t.tab.el.querySelector<HTMLButtonElement>(".rd-notes-back")!.click();
    expect(t.bar()).toBeNull();
    t.tab.reveal("n2");
    await wait(60);
    expect(t.tab.el.querySelectorAll(".qmd-note-bar")).toHaveLength(1);
    t.runAll()!.click();
    await wait(300);
    expect(t.runs().map((m) => m["label"])).toEqual(["other"]);
    t.tab.onHide();
  }));

  it("4.2a loads the open item's view state from the port the tab was given", behaviour(async () => {
    const port = { load: jest.fn(() => undefined), save: jest.fn() };
    const t = setup({ viewState: port });
    t.tab.reveal("n1");
    await wait(60);
    const keys = port.load.mock.calls.map((call) => String((call as unknown[])[0]));
    expect(keys.some((key) => key.endsWith("\nn1"))).toBe(true);
    t.tab.onHide();
  }));
});
