/** Pins the project a share connection mirrors: sharing seeds the comments map from comments.json, and a history restore reaches peers as doc edits and index removals. */
import * as Y from "yjs";
import { readFileText, readLiveThreads, readShareIndexDocFiles, type ShareSession } from "../../../src/collab/index";
import { applyRestoredFiles, ensureSharedProject } from "../../../src/collab/session/index";
import type { ILogger } from "../../../src/ports/index";
import type { ProjectCatalogContext } from "../../../src/writing/project/index";
import { fakeLogger } from "../testSession";

const FOLDER = "/lib/p";
const SHARE_ID = "f".repeat(32);

/** An in-memory file system whose missing-file error carries no `code`, like the browser adapters. */
function projectContext(files: Map<string, string>) {
  const logger = fakeLogger();
  const context = {
    logger,
    paths: { join: (...parts: string[]) => parts.join("/") },
    fs: {
      exists: async (file: string) => files.has(file),
      readText: async (file: string) => {
        const text = files.get(file);
        if (text === undefined) { throw new Error(`File not found: ${file}`); }
        return text;
      },
      writeText: async (file: string, text: string) => { files.set(file, text); },
    },
  } as unknown as ProjectCatalogContext;
  return { context, logger };
}

const share = (context: ProjectCatalogContext, index: Y.Doc) =>
  ensureSharedProject({ context, libraryRoot: "/lib" }, SHARE_ID, { index } as unknown as ShareSession, { mode: "share", folder: FOLDER });

describe("ensureSharedProject in share mode", () => {
  it("shares a project that has no comments.json", async () => {
    const { context, logger } = projectContext(new Map([[`${FOLDER}/labshelf.yaml`, "id: p\n"]]));
    const index = new Y.Doc();
    await expect(share(context, index)).resolves.toEqual({ folder: FOLDER, joinedId: undefined });
    expect(logger.error).not.toHaveBeenCalled();
    expect(readLiveThreads(index)).toEqual([]);
  });

  it("imports the threads of comments.json into the session", async () => {
    const thread = {
      id: "t1", file: "main.tex", anchor: { quote: "q", prefix: "a", suffix: "b" },
      comments: [{ id: "c1", author: "Ana", body: "x", createdAt: "2026-10-16T09:00:00.000Z" }], resolved: false,
    };
    const { context } = projectContext(new Map([
      [`${FOLDER}/labshelf.yaml`, "id: p\n"],
      [`${FOLDER}/.labshelf/comments.json`, JSON.stringify({ threads: [thread] })],
    ]));
    const index = new Y.Doc();
    await share(context, index);
    expect(readLiveThreads(index).map((each) => each.id)).toEqual(["t1"]);
  });
});

const restoreLogger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
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
    readShareIndexDocFiles(mine.index).set("main.tex", { kind: "text" });
    readFileText(mine.openDoc("main.tex")).insert(0, "stale");
    const peer = new Y.Doc();
    syncInto(mine.docs.get("main.tex")!, peer);
    await applyRestoredFiles({ session: mine, restored: async () => "restored", origin: ORIGIN, logger: restoreLogger });
    syncInto(mine.docs.get("main.tex")!, peer);
    expect(readFileText(peer).toString()).toBe("restored");
  });

  it("removes a file the restore deleted from the index, and the removal reaches a peer", async () => {
    const mine = sharedSession();
    readShareIndexDocFiles(mine.index).set("gone.tex", { kind: "text" });
    readShareIndexDocFiles(mine.index).set("kept.tex", { kind: "text" });
    const peerIndex = new Y.Doc();
    syncInto(mine.index, peerIndex);
    await applyRestoredFiles({ session: mine, restored: async (path) => (path === "gone.tex" ? null : readFileText(mine.openDoc(path)).toString()), origin: ORIGIN, logger: restoreLogger });
    syncInto(mine.index, peerIndex);
    expect([...readShareIndexDocFiles(peerIndex).keys()]).toEqual(["kept.tex"]);
  });

  it("leaves an unchanged file, a blob and an unsafe path alone", async () => {
    const mine = sharedSession();
    readShareIndexDocFiles(mine.index).set("same.tex", { kind: "text" });
    readShareIndexDocFiles(mine.index).set("fig.png", { kind: "blob", hash: "ab" });
    readShareIndexDocFiles(mine.index).set("../escape.tex", { kind: "text" });
    readFileText(mine.openDoc("same.tex")).insert(0, "text");
    const updates: unknown[] = [];
    mine.docs.get("same.tex")!.on("update", (update: Uint8Array) => updates.push(update));
    const read = jest.fn(async () => "text");
    await applyRestoredFiles({ session: mine, restored: read, origin: ORIGIN, logger: restoreLogger });
    expect(updates).toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(readShareIndexDocFiles(mine.index).has("fig.png")).toBe(true);
  });

  it("applies the edit under the given origin and logs the counts", async () => {
    const mine = sharedSession();
    readShareIndexDocFiles(mine.index).set("a.tex", { kind: "text" });
    readShareIndexDocFiles(mine.index).set("b.tex", { kind: "text" });
    const origins: unknown[] = [];
    mine.openDoc("a.tex").on("update", (_update: Uint8Array, origin: unknown) => origins.push(origin));
    await applyRestoredFiles({ session: mine, restored: async (path) => (path === "a.tex" ? "new" : null), origin: ORIGIN, logger: restoreLogger });
    expect(origins).toEqual([ORIGIN]);
    expect(restoreLogger.log).toHaveBeenCalledWith("INFO", expect.any(String), expect.any(String), { updated: 1, removed: 1 });
  });
});
