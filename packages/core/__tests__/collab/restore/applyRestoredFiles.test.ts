/** Pins that a restore reaches peers: restored text becomes a doc edit and a removed file leaves the share index. */
import * as Y from "yjs";
import { applyRestoredFiles, fileText, indexFiles } from "../../../src/collab/index";
import type { ILogger } from "../../../src/index";

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const ORIGIN = "restore";

function sharedSession() {
  const index = new Y.Doc();
  const docs = new Map<string, Y.Doc>();
  const openDoc = (path: string): Y.Doc => { if (!docs.has(path)) docs.set(path, new Y.Doc()); return docs.get(path)!; };
  return { index, openDoc, docs };
}

const syncInto = (from: Y.Doc, to: Y.Doc): void => Y.applyUpdate(to, Y.encodeStateAsUpdate(from));

describe("applyRestoredFiles", () => {
  it("writes the restored text into the doc so a peer receives it", async () => {
    const mine = sharedSession();
    indexFiles(mine.index).set("main.tex", { kind: "text" });
    fileText(mine.openDoc("main.tex")).insert(0, "stale");
    const peer = new Y.Doc();
    syncInto(mine.docs.get("main.tex")!, peer);
    await applyRestoredFiles({ session: mine, restored: async () => "restored", origin: ORIGIN, logger });
    syncInto(mine.docs.get("main.tex")!, peer);
    expect(fileText(peer).toString()).toBe("restored");
  });

  it("removes a file the restore deleted from the index, and the removal reaches a peer", async () => {
    const mine = sharedSession();
    indexFiles(mine.index).set("gone.tex", { kind: "text" });
    indexFiles(mine.index).set("kept.tex", { kind: "text" });
    const peerIndex = new Y.Doc();
    syncInto(mine.index, peerIndex);
    await applyRestoredFiles({ session: mine, restored: async (path) => (path === "gone.tex" ? null : fileText(mine.openDoc(path)).toString()), origin: ORIGIN, logger });
    syncInto(mine.index, peerIndex);
    expect([...indexFiles(peerIndex).keys()]).toEqual(["kept.tex"]);
  });

  it("leaves an unchanged file, a blob and an unsafe path alone", async () => {
    const mine = sharedSession();
    indexFiles(mine.index).set("same.tex", { kind: "text" });
    indexFiles(mine.index).set("fig.png", { kind: "blob", hash: "ab" });
    indexFiles(mine.index).set("../escape.tex", { kind: "text" });
    fileText(mine.openDoc("same.tex")).insert(0, "text");
    const updates: unknown[] = [];
    mine.docs.get("same.tex")!.on("update", (update: Uint8Array) => updates.push(update));
    const read = jest.fn(async () => "text");
    await applyRestoredFiles({ session: mine, restored: read, origin: ORIGIN, logger });
    expect(updates).toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(indexFiles(mine.index).has("fig.png")).toBe(true);
  });

  it("applies the edit under the given origin and logs the counts", async () => {
    const mine = sharedSession();
    indexFiles(mine.index).set("a.tex", { kind: "text" });
    indexFiles(mine.index).set("b.tex", { kind: "text" });
    const origins: unknown[] = [];
    mine.openDoc("a.tex").on("update", (_update: Uint8Array, origin: unknown) => origins.push(origin));
    await applyRestoredFiles({ session: mine, restored: async (path) => (path === "a.tex" ? "new" : null), origin: ORIGIN, logger });
    expect(origins).toEqual([ORIGIN]);
    expect(logger.log).toHaveBeenCalledWith("INFO", expect.any(String), expect.any(String), { updated: 1, removed: 1 });
  });
});
