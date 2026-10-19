// The history host records the project on ready, answers diffs, restores a point after confirmation and marks versions.
import type { HistoryToHost, HostToHistory, ILogger } from "@labshelf/core";
import { createLoopbackTransport } from "@labshelf/core";
import { toast, confirmDialog } from "@labshelf/core/dom";
import { mountHistoryHost, recordProjectEdit } from "../../../../src/library-page/review/history";
import { clearFakeDb } from "../../../support/fakeIdb";
import { memoryLibraryFs } from "../../../support/memoryLibraryFs";

jest.mock("@labshelf/core/dom", () => ({ toast: jest.fn(), confirmDialog: jest.fn(), inputBox: jest.fn() }));
jest.mock("../../../../src/storage/idb/db", () => ({ getDb: async () => require("../../../support/fakeIdb").fakeDb }));

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;
const project = { id: "thesis", folder: "proj" };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await tick(); };

function setup() {
  const fs = memoryLibraryFs();
  const { ui, host } = createLoopbackTransport<HistoryToHost, HostToHistory>();
  const received: HostToHistory[] = [];
  ui.subscribe((message) => received.push(message));
  const mounted = mountHistoryHost({ fs, logger, endpoint: host, project, lastFullPdf: () => undefined });
  const history = () => received.filter((m): m is Extract<HostToHistory, { type: "history" }> => m.type === "history");
  return { fs, ui, received, history, mounted };
}

beforeEach(() => { clearFakeDb(); jest.clearAllMocks(); });

describe("mountHistoryHost", () => {
  it("records the project on ready and posts its rows", async () => {
    const { fs, ui, history } = setup();
    await fs.writeText("proj/main.typ", "one");
    ui.post({ type: "ready" });
    await settle();
    expect(history()).toHaveLength(1);
    expect(history()[0]).toMatchObject({ project: "thesis", rows: [{ kind: "edit", changes: [{ path: "main.typ" }] }] });
  });

  it("posts the rows again when a save records an edit while the page is open", async () => {
    const { fs, ui, history } = setup();
    await fs.writeText("proj/main.typ", "one");
    ui.post({ type: "ready" });
    await settle();
    await fs.writeText("proj/main.typ", "two");
    await recordProjectEdit({ fs, logger }, project);
    await settle();
    expect(history().map((message) => message.rows.length)).toEqual([1, 2]);
  });

  it("answers a diff request with the lines the entry changed", async () => {
    const { fs, ui, received, history } = setup();
    await fs.writeText("proj/main.typ", "one");
    ui.post({ type: "ready" });
    await settle();
    ui.post({ type: "diff", id: history()[0]!.rows[0]!.id, path: "main.typ" });
    await settle();
    const diff = received.find((m) => m.type === "diff");
    expect(diff).toMatchObject({ type: "diff", path: "main.typ", lines: [{ kind: "added" }] });
  });

  it("restores the confirmed point, keeps the current state in the history and toasts", async () => {
    const { fs, ui, received, history } = setup();
    await fs.writeText("proj/main.typ", "one");
    ui.post({ type: "ready" });
    await settle();
    await fs.writeText("proj/main.typ", "two");
    ui.post({ type: "ready" });
    await settle();
    const [, first] = history()[1]!.rows;
    (confirmDialog as jest.Mock).mockResolvedValue(true);
    ui.post({ type: "restore", id: first!.id });
    await settle();
    expect(await fs.readText("proj/main.typ")).toBe("one");
    expect(received.filter((m) => m.type === "busy")).toEqual([{ type: "busy", busy: true }, { type: "busy", busy: false }]);
    expect(history().at(-1)!.rows.length).toBe(3);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Restored thesis to /), "ok");
  });

  it("leaves the files alone when the restore is declined", async () => {
    const { fs, ui, history } = setup();
    await fs.writeText("proj/main.typ", "one");
    ui.post({ type: "ready" });
    await settle();
    await fs.writeText("proj/main.typ", "two");
    (confirmDialog as jest.Mock).mockResolvedValue(false);
    ui.post({ type: "restore", id: history()[0]!.rows[0]!.id });
    await settle();
    expect(await fs.readText("proj/main.typ")).toBe("two");
  });

  it("says Compare Versions needs another app", async () => {
    const { ui } = setup();
    ui.post({ type: "compareVersions" });
    await settle();
    expect(toast).toHaveBeenCalledWith("Compare Versions needs the VS Code extension or the terminal app.");
  });

  it("stops answering after dispose", async () => {
    const { fs, ui, history, mounted } = setup();
    await fs.writeText("proj/main.typ", "one");
    mounted.dispose();
    ui.post({ type: "ready" });
    await settle();
    expect(history()).toHaveLength(0);
  });
});
