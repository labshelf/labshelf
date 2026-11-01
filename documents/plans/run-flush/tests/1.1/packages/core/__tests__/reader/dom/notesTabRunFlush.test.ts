/** @jest-environment jsdom */
// Tests that a param release in the reader's Notes tab keeps the run's stored output: the edited param line reaches the host before
// the run starts, so the draft saved later cannot overwrite the body a fast run has already written the output into.
//
// The fake host stores the item body like the real one: `editNote` replaces the body, a normal `runCell` writes its output into the
// stored body (with the real writeCellOutput) after `runMs` and pushes it, a preview is answered after 20 ms.
import { TextEncoder as NodeTextEncoder } from "node:util";
import { NotesTab } from "../../../src/reader/dom/notesTab";
import type { ReaderNote } from "../../../src/reader/protocol/messages";
import { writeCellOutput } from "../../../src/qmd/compute/writeCellOutput";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const CELL = "```{python}\n#| label: calc\n#| param: n = slider(0, 10, 3)\nprint(n)\n```\n";
const note: ReaderNote = { id: "n1", anchor: "p2 box 0.1 0.2 0.3 0.4", body: `Intro\n\n${CELL}`, created: "2026-10-01T00:00:00.000Z", author: "Ana" } as ReaderNote;

/** The editor's output views showing a stored output (a drag preview result is not one). */
const storedOutputs = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(".qmd-output:not(.is-preview)")];

/** Mounts the tab on the fake host, drags the slider to 7 and releases it, then waits `settleMs`. */
async function releaseSlider(runMs: number, settleMs: number) {
  let stored = note.body;
  const sent: Array<Record<string, unknown>> = [];
  const handlers = new Map<string, Array<(e?: unknown) => void>>();
  const eventBus = { on: (name: string, fn: (e?: unknown) => void) => handlers.set(name, [...(handlers.get(name) ?? []), fn]), off: () => undefined, dispatch: () => undefined };
  document.body.replaceChildren();
  const host = { post: (_m: Record<string, unknown>) => undefined } as { post(m: Record<string, unknown>): void };
  const tab = new NotesTab(host as never, jest.fn(), () => 1, eventBus as never);
  document.body.append(tab.el);
  const push = () => tab.show([{ ...note, body: stored }]);
  host.post = (m) => {
    sent.push(m);
    if (m["command"] === "runCell" && m["preview"]) {
      setTimeout(() => tab.runs.showPreview(String(m["requestId"]), { status: "ok", language: "python", text: "7", durationMs: 5 }), 20);
    }
    if (m["command"] === "runCell" && !m["preview"]) {
      setTimeout(() => tab.showCellState(String(m["requestId"]), "running"), 0);
      setTimeout(() => {
        void writeCellOutput(stored, "calc", { status: "ok", language: "python", text: "7", durationMs: 5 }, { ran: "2026-10-31T00:00:00.000Z", params: m["params"] as Record<string, number> }).then((next) => {
          stored = next; push(); tab.showCellState(String(m["requestId"]), "done");
        });
      }, runMs);
    }
    if (m["command"] === "editNote") { stored = String(m["body"]); push(); }
  };
  tab.setCanRunCells(true);
  push();
  tab.reveal("n1");
  await wait(60);
  const range = tab.el.querySelector<HTMLInputElement>('input[type="range"]')!;
  range.value = "7";
  range.dispatchEvent(new Event("input", { bubbles: true }));
  range.dispatchEvent(new Event("change", { bubbles: true }));
  await wait(settleMs);
  return { tab, sent, stored: () => stored, normalRuns: () => sent.filter((m) => m["command"] === "runCell" && !m["preview"]) };
}

// A param release writes the new value into the cell's param line (an editor change, saved after the editor and save debounces) and
// runs the cell at once. A run that ends before that save lands must keep its output: the saved draft may not overwrite the host's body.
describe("param release in the Notes tab", () => {
  it("A1 keeps the output of a param release run that ends before the edited param line is saved", async () => {
    const t = await releaseSlider(50, 1300);
    expect(t.normalRuns()).toHaveLength(1);
    expect(t.stored()).toContain("slider(0, 10, 7)");
    expect(t.stored()).toContain('params="n=7"');
    t.tab.onHide();
  });

  it("A2 shows the new output in the editor without the Out-of-date caption", async () => {
    const t = await releaseSlider(50, 1300);
    const outputs = storedOutputs(t.tab.el);
    expect(outputs.length).toBeGreaterThan(0);
    expect(outputs.some((o) => o.classList.contains("is-out-of-date"))).toBe(false);
    expect(t.tab.el.textContent).not.toMatch(/out of date/i);
    expect(outputs.map((o) => o.textContent).join(" ")).toContain("7");
    expect(t.stored()).toContain("labshelf-output");
    t.tab.onHide();
  });

  it("A3 posts exactly one normal runCell for a release, with the released values", async () => {
    const t = await releaseSlider(50, 300);
    expect(t.normalRuns()).toHaveLength(1);
    expect(t.normalRuns()[0]).toMatchObject({ command: "runCell", itemId: "n1", label: "calc", language: "python", params: { n: 7 } });
    expect(String(t.normalRuns()[0]!["code"])).toContain("print(n)");
    expect(t.sent.filter((m) => m["command"] === "runCell" && m["preview"]).length).toBeGreaterThanOrEqual(1);
    t.tab.onHide();
  });

  it("A4 keeps the param line and the output when the run is slower than the save delay", async () => {
    const t = await releaseSlider(900, 2100);
    expect(t.normalRuns()).toHaveLength(1);
    expect(t.stored()).toContain("slider(0, 10, 7)");
    expect(t.stored()).toContain('params="n=7"');
    const outputs = storedOutputs(t.tab.el);
    expect(outputs.length).toBeGreaterThan(0);
    expect(outputs.some((o) => o.classList.contains("is-out-of-date"))).toBe(false);
    expect(t.tab.el.textContent).not.toMatch(/out of date/i);
    t.tab.onHide();
  });

  it("A5 posts the edited body before the normal runCell in the Notes tab", async () => {
    const t = await releaseSlider(50, 700);
    const at = (pred: (m: Record<string, unknown>) => boolean) => t.sent.findIndex(pred);
    const edit = at((m) => m["command"] === "editNote" && String(m["body"]).includes("slider(0, 10, 7)"));
    const run = at((m) => m["command"] === "runCell" && !m["preview"]);
    expect(run).toBeGreaterThanOrEqual(0);
    expect(edit).toBeGreaterThanOrEqual(0);
    expect(edit).toBeLessThan(run);
    t.tab.onHide();
  });
});
