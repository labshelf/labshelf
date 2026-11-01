/** @jest-environment jsdom */
// Tests that a param release in the floating note editor sends the edited body (editNote) to the host before it posts the normal runCell.
import { TextEncoder as NodeTextEncoder } from "node:util";
import { FloatingNotes } from "../../../src/reader/dom/floatingNotes";
import type { ReaderContext } from "../../../src/reader/dom/readerSession";
import type { ReaderNote } from "../../../src/reader/protocol/index";

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const CELL = "```{python}\n#| label: calc\n#| param: n = slider(0, 10, 3)\nprint(n)\n```\n";
const note: ReaderNote = { id: "n1", anchor: "p4 point 0.7 0.3", body: `Intro\n\n${CELL}`, author: "Ana", created: "2026-10-30" };
let floating: FloatingNotes | undefined;
afterEach(() => { floating?.close(false); floating = undefined; document.body.innerHTML = ""; });

describe("param release in the floating note editor", () => {
  it("A5 posts the edited body before the normal runCell in the floating note editor", async () => {
    document.body.innerHTML = '<div id="viewer"><div class="page" data-page-number="4"><div class="textLayer"></div></div></div>';
    const sent: Array<Record<string, unknown>> = [];
    const host = {
      post: (m: Record<string, unknown>) => {
        sent.push(m);
        if (m["command"] === "runCell" && m["preview"]) {
          setTimeout(() => floating!.runs.showPreview(String(m["requestId"]), { status: "ok", language: "python", text: "7", durationMs: 5 }), 20);
        }
      },
    };
    const ctx = { host, eventBus: { on: jest.fn() }, container: document.getElementById("viewer"), pdfViewer: { currentPageNumber: 4 } } as unknown as ReaderContext;
    floating = new FloatingNotes(ctx, jest.fn());
    floating.show([note]);
    document.querySelector<HTMLButtonElement>(".rd-note-pin")!.click();
    floating.setCanRunCells(true);
    await wait(60);
    const range = document.querySelector<HTMLInputElement>('.rd-floating-note input[type="range"]')!;
    range.value = "7";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    range.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(600);
    const edit = sent.findIndex((m) => m["command"] === "editNote" && String(m["body"]).includes("slider(0, 10, 7)"));
    const run = sent.findIndex((m) => m["command"] === "runCell" && !m["preview"]);
    expect(run).toBeGreaterThanOrEqual(0);
    expect(sent[run]).toMatchObject({ itemId: "n1", label: "calc", params: { n: 7 } });
    expect(edit).toBeGreaterThanOrEqual(0);
    expect(edit).toBeLessThan(run);
  });
});
