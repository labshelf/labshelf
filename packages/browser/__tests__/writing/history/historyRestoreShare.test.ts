/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Restores a shared project from history into the docs of files no editor has open, so the disk mirror keeps the restored text.
import * as Y from "yjs";
import type { HistoryToHost, HostToHistory, ILogger } from "@labshelf/core";
import { createLoopbackTransport, readFileText, readShareIndexDocFiles } from "@labshelf/core";
import { askDialog } from "@labshelf/core/dom";
import { mountHistoryHost } from "../../../src/writing/history";
import { clearFakeDb } from "../../support/fakeIdb";
import { memoryLibraryFs } from "../../support/memoryLibraryFs";

jest.mock("@labshelf/core/dom", () => ({ showToast: jest.fn(), askDialog: jest.fn(), askInputBox: jest.fn() }));
jest.mock("../../../src/storage/idbDatabase", () => ({ getDb: async () => require("../../support/fakeIdb").fakeDb }));

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const project = { id: "thesis", folder: "proj" };
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await jest.advanceTimersByTimeAsync(0); };

async function setup() {
  const fs = memoryLibraryFs();
  const index = new Y.Doc();
  const docs = new Map<string, Y.Doc>();
  const session = { index, openDoc: (path: string) => { if (!docs.has(path)) docs.set(path, new Y.Doc()); return docs.get(path)!; } };
  const { ui, host } = createLoopbackTransport<HistoryToHost, HostToHistory>();
  const rows: Extract<HostToHistory, { type: "history" }>["rows"][] = [];
  ui.subscribe((message) => { if (message.type === "history") rows.push(message.rows); });
  mountHistoryHost({ fs, logger, endpoint: host, project, lastFullPdf: () => undefined, shares: { live: () => ({ session } as never) } });
  await fs.writeText("proj/main.tex", "one");
  ui.post({ type: "ready" });
  await settle();
  for (const [path, text] of [["main.tex", "two"], ["added.tex", "later"]] as const) {
    readShareIndexDocFiles(index).set(path, { kind: "text" });
    readFileText(session.openDoc(path)).insert(0, text);
    await fs.writeText(`proj/${path}`, text);
  }
  return { fs, ui, index, session, firstId: rows[0]![0]!.id };
}

beforeEach(() => { jest.useFakeTimers(); clearFakeDb(); jest.clearAllMocks(); (askDialog as jest.Mock).mockResolvedValue(true); });
afterEach(() => { jest.useRealTimers(); });

describe("history restore of a shared project", () => {
  it("holds the restored text in the doc of a file no editor has open, and on disk", async () => {
    const { fs, ui, session, firstId } = await setup();
    ui.post({ type: "restore", id: firstId });
    await settle();
    expect(readFileText(session.openDoc("main.tex")).toString()).toBe("one");
    await jest.advanceTimersByTimeAsync(1000);
    expect(await fs.readText("proj/main.tex")).toBe("one");
  });

  it("drops a file the restore removed from the share index, and from disk", async () => {
    const { fs, ui, index, firstId } = await setup();
    ui.post({ type: "restore", id: firstId });
    await settle();
    await jest.advanceTimersByTimeAsync(1000);
    expect(readShareIndexDocFiles(index).has("added.tex")).toBe(false);
    expect(await fs.exists("proj/added.tex")).toBe(false);
  });
});
