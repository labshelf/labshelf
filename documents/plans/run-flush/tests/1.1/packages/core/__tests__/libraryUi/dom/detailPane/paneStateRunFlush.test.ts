/** @jest-environment jsdom */
// Tests that a param release in the paper detail pane's notes sends the edited body (paper.editNote) to the host before the normal paper.runCell.
import { TextEncoder as NodeTextEncoder } from "node:util";
import { ALL_CAPABILITIES, mountForTest, paper } from "../mountHarness";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const CELL = "```{python}\n#| label: calc\n#| param: n = slider(0, 10, 3)\nprint(n)\n```\n";

describe("param release in the paper detail pane notes", () => {
  it("A5 posts the edited body before the normal paper.runCell in the library detail pane", async () => {
    const t = mountForTest({ detailTab: "notes" }, ALL_CAPABILITIES);
    const order: Array<Record<string, unknown>> = [];
    t.host.subscribe((m) => {
      const msg = m as unknown as Record<string, unknown>;
      order.push(msg);
      if (msg["type"] === "paper.runCell" && msg["preview"]) {
        setTimeout(() => t.host.post({ type: "paper.cellPreview", requestId: msg["requestId"], result: { status: "ok", language: "python", text: "7", durationMs: 5 } } as never), 20);
      }
    });
    t.snapshot([paper("a", "papers")], ["papers/a"]);
    t.host.post({ type: "select", id: "a" });
    const notes = [{ id: "n1", anchor: "", body: `Intro\n\n${CELL}`, created: "2026-10-01T00:00:00.000Z", author: "Ana" }];
    t.host.post({ type: "details", id: "a", details: { annotations: [], reading: null, pdf: null, notes, canRunCells: true }, canRunCells: true } as never);
    await wait(100);
    const range = t.detail().querySelector<HTMLInputElement>('input[type="range"]')!;
    range.value = "7";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    range.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(600);
    const edit = order.findIndex((m) => m["type"] === "paper.editNote" && String(m["body"]).includes("slider(0, 10, 7)"));
    const run = order.findIndex((m) => m["type"] === "paper.runCell" && !m["preview"]);
    expect(run).toBeGreaterThanOrEqual(0);
    expect(order[run]).toMatchObject({ id: "a", itemId: "n1", label: "calc", params: { n: 7 } });
    expect(edit).toBeGreaterThanOrEqual(0);
    expect(edit).toBeLessThan(run);
    expect(order[edit]).toMatchObject({ id: "a", itemId: "n1" });
  });
});
