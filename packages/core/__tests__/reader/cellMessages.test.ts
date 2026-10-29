// Tests the reader host's run-cell flow: cellState running first, output written through the notes store, updateNotes before the end cellState, and the missing-port answer.
import { PaperNotesStore, type CellResult, type HostToWebview } from "@labshelf/core";
import { setupHost } from "./hostFixture";

const ID = "n-01JB2QN0000000000000000000";
const SEED = `::: {#${ID} .labshelf-item anchor="" author="Ana" created="2026-10-01T00:00:00.000Z"}\n\`\`\`{python}\n#| label: calc\nprint(1)\n\`\`\`\n:::\n`;

function setup(runCell?: (code: string, signal: AbortSignal) => Promise<CellResult>) {
  const base = setupHost();
  const files: Record<string, string> = { p1: SEED };
  const notes = new PaperNotesStore({ read: async (id) => files[id] ?? null, write: async (id, text) => { files[id] = text; } }, { logger: base.ports.logger });
  Object.assign(base.ports, { notes, ...(runCell ? { runCell } : {}) });
  return { ...base, files };
}

const runMessage = { command: "runCell", itemId: ID, label: "calc", code: "print(1)", requestId: "r1" } as const;

describe("reader runCell", () => {
  it("posts running, writes the output, pushes updateNotes, then posts cellState done", async () => {
    const { host, posted, files } = setup(async () => ({ status: "ok", text: "1", durationMs: 1 }));
    await host.handle(runMessage);
    expect(files.p1).toContain("1");
    expect(files.p1!.length).toBeGreaterThan(SEED.length);
    const types = posted.map((m: HostToWebview) => m.type);
    expect(types.indexOf("updateNotes")).toBeGreaterThanOrEqual(0);
    expect(posted.find((m: HostToWebview) => m.type === "cellState")).toEqual({ type: "cellState", requestId: "r1", state: "running" });
    expect(types.indexOf("cellState")).toBeLessThan(types.indexOf("updateNotes"));
    expect(types.indexOf("updateNotes")).toBeLessThan(types.lastIndexOf("cellState"));
    expect(posted.at(-1)).toEqual({ type: "cellState", requestId: "r1", state: "done" });
  });

  it("answers cellState error and writes nothing when the host has no runner", async () => {
    const { host, posted, files } = setup();
    await host.handle(runMessage);
    expect(files.p1).toBe(SEED);
    expect(posted).toEqual([{ type: "cellState", requestId: "r1", state: "error" }]);
  });

  it("cancels a running cell by request id and writes nothing", async () => {
    const { host, posted, files } = setup((_code, signal) => new Promise((resolve) => {
      signal.addEventListener("abort", () => resolve({ status: "cancelled", durationMs: 1 }));
    }));
    const running = host.handle(runMessage);
    await host.handle({ command: "cancelCell", requestId: "r1" });
    await running;
    expect(files.p1).toBe(SEED);
    expect(posted.at(-1)).toEqual({ type: "cellState", requestId: "r1", state: "cancelled" });
  });
});
