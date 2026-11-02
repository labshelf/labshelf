/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Tests the browser project note tab with the real editors: the note bar sits above the items, its Run all runs the cells of every item in file
// order through the helper port (one at a time), there is no bar for an empty note, and the view state port is keyed `project:<id>:<path>\n<itemId>`.
//
// Assumptions about what the spec leaves open: the bar is the `.qmd-note-bar` element with a button aria-label 'Run all' (plan decided of spec 4.1);
// TabContext.noteViewState is the QmdViewStatePort; the helper port is the one getBrowserCellPorts(...).runCellIn(projectId) returns.
import type { CellRequest, CellResult, ILogger } from "@labshelf/core";
import { TAB_KINDS, type TabContext } from "../../../src/libraryUi/editorArea/tabKinds";

// jsdom has no layout; CodeMirror measures text ranges.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

interface Pending { request: CellRequest; resolve(result: CellResult): void }
const pending: Pending[] = [];
const ports = {
  runCellIn: (_projectId: string) => (request: CellRequest) => new Promise<CellResult>((resolve) => { pending.push({ request, resolve }); }),
  restartCell: jest.fn(async () => undefined),
  runMath: undefined,
  installPython: jest.fn(),
};
jest.mock("../../../src/helper", () => ({ getBrowserCellPorts: () => ports }));

/** Turns any failure into "not implemented: ..." so a red run shows the behaviour is absent; the original message is kept. */
const it = (name: string, body: () => Promise<void> | void): void => {
  globalThis.it(name, async () => {
    try { await body(); } catch (error) { throw new Error(`not implemented: the note bar (${error instanceof Error ? error.message : String(error)})`); }
  }, 20000);
};

const OK: CellResult = { status: "ok", language: "python", text: "1", durationMs: 1 };
const PATH = "notes/n.qmd";
const item = (id: string, label: string) => `::: {#${id} .labshelf-item author="Ana" created="2026-10-01T00:00:00.000Z"}\nIntro ${label}\n\n\`\`\`{python}\n#| label: ${label}\nprint("${label}")\n\`\`\`\n:::\n`;
// The ids are not in alphabetical order, so only file order gives item-b before item-a.
const FILE = item("item-b", "cb") + "\n" + item("item-a", "ca");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await wait(10);
}
const runAll = (root: ParentNode) => root.querySelector<HTMLButtonElement>('.qmd-note-bar button[aria-label="Run all"]');

async function open(text: string | null, noteViewState?: { load: jest.Mock; save: jest.Mock }) {
  pending.length = 0;
  const logger: ILogger = { log: async () => undefined, error: async () => undefined };
  const edits: Array<[string, string]> = [];
  const notes = { read: async () => text, editItem: async (_p: string, _path: string, id: string, body: string) => { edits.push([id, body]); } };
  const ctx = { logger, tab: { setDirty: jest.fn(), onBeforeClose: jest.fn() }, project: () => ({ notes }), ...(noteViewState ? { noteViewState } : {}) } as unknown as TabContext;
  document.body.replaceChildren();
  const host = document.createElement("div");
  document.body.append(host);
  const { mountTab } = await TAB_KINDS.source.load();
  const tab = mountTab(host, { projectId: "p1", path: PATH }, ctx);
  await until(() => host.querySelector(".qmd-cell") !== null || host.querySelector(".ls-empty-text") !== null);
  await wait(50);
  return { host, tab, edits };
}

describe("project note tab note bar", () => {
  it("4.3a shows one note bar above the items", async () => {
    const t = await open(FILE);
    expect(t.host.querySelectorAll(".qmd-note-bar")).toHaveLength(1);
    const bar = t.host.querySelector(".qmd-note-bar")!;
    const firstItem = t.host.querySelector(".qmd-note-file-item")!;
    expect(firstItem).not.toBeNull();
    expect(bar.compareDocumentPosition(firstItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    t.tab.dispose();
  });

  it("4.3a Run all runs the cells of the items in file order, one at a time, in the note's session", async () => {
    const t = await open(FILE);
    expect(runAll(t.host)!.disabled).toBe(false);
    runAll(t.host)!.click();
    await until(() => pending.length >= 1);
    expect(pending.map((p) => p.request.code.trim())).toEqual(['print("cb")']);
    expect(pending[0]!.request.noteKey).toBe(`project:p1:${PATH}`);
    await wait(150);
    expect(pending).toHaveLength(1);
    pending[0]!.resolve(OK);
    await until(() => pending.length >= 2);
    expect(pending.map((p) => p.request.code.trim())).toEqual(['print("cb")', 'print("ca")']);
    pending[1]!.resolve(OK);
    await wait(100);
    t.tab.dispose();
  });

  it("4.3a Run all stops at a failing cell and does not run the next item's cell", async () => {
    const t = await open(FILE);
    runAll(t.host)!.click();
    await until(() => pending.length >= 1);
    pending[0]!.resolve({ ...OK, status: "error", error: "boom" });
    await wait(300);
    expect(pending).toHaveLength(1);
    t.tab.dispose();
  });

  it("4.3a shows no note bar for an empty note", async () => {
    const t = await open("");
    expect(t.host.querySelector(".ls-empty-text")).not.toBeNull();
    expect(t.host.querySelector(".qmd-note-bar")).toBeNull();
    t.tab.dispose();
  });

  it("4.3a loads each item's view state under project:<id>:<path>\\n<itemId>", async () => {
    const port = { load: jest.fn((_key: string): unknown => undefined), save: jest.fn() };
    const t = await open(FILE, port);
    const keys = port.load.mock.calls.map((call) => call[0]);
    expect(keys).toContain(`project:p1:${PATH}\nitem-b`);
    expect(keys).toContain(`project:p1:${PATH}\nitem-a`);
    t.tab.dispose();
  });
});
