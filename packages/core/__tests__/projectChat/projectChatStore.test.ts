/** Pins the project chat store over .labshelf/chat.qmd: creation on first send, author-only edit and delete, `edited`, serial writes, and the device-local unread count. */
import { countProjectChatUnread, createProjectChatStore, markProjectChatSeen, projectChatFilePath, type ProjectChatStoreContext } from "../../src/projectChat/index";

function memoryContext(): ProjectChatStoreContext & { files: Map<string, string>; dirs: Set<string> } {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  let tick = 0;
  return {
    files, dirs,
    fs: {
      exists: async (path) => files.has(path) || dirs.has(path),
      readText: async (path) => files.get(path) ?? "",
      writeText: async (path, text) => { files.set(path, text); },
      ensureDir: async (path) => { dirs.add(path); },
    },
    logger: { log: async () => {}, error: async () => {} } as never,
    now: () => new Date(Date.UTC(2026, 10, 9, 10, 0, tick++)).toISOString(),
  };
}

const DIR = "/p/thesis";
const FILE = "/p/thesis/.labshelf/chat.qmd";

describe("createProjectChatStore", () => {
  it("D1 creates .labshelf/ and the file on the first send, one item per message with author and created", async () => {
    const ctx = memoryContext();
    const store = createProjectChatStore(ctx);
    expect(await store.read(DIR)).toEqual([]);
    const id = await store.add(DIR, "Hello.", "Ana");
    expect(ctx.dirs.has("/p/thesis/.labshelf")).toBe(true);
    expect(ctx.files.get(FILE)).toContain(`{#${id} .labshelf-item`);
    expect(await store.read(DIR)).toEqual([{ id, author: "Ana", created: "2026-11-09T10:00:00.000Z", body: "Hello." }]);
  });

  it("D5 lets only the author edit, stamping edited, and remove", async () => {
    const store = createProjectChatStore(memoryContext());
    const id = await store.add(DIR, "Draft", "Ana");
    await expect(store.edit(DIR, id, "Hacked", "Bo", "2026-11-09T11:00:00.000Z")).rejects.toThrow(/author/);
    await expect(store.remove(DIR, id, "Bo")).rejects.toThrow(/author/);
    await store.edit(DIR, id, "Final", "Ana", "2026-11-09T11:00:00.000Z");
    expect(await store.read(DIR)).toEqual([expect.objectContaining({ id, body: "Final", edited: "2026-11-09T11:00:00.000Z" })]);
    await expect(store.edit(DIR, "m-missing", "x", "Ana", "2026-11-09T11:00:00.000Z")).rejects.toThrow(/id/);
    await store.remove(DIR, id, "Ana");
    expect(await store.read(DIR)).toEqual([]);
  });

  it("keeps every message of concurrent sends and tells listeners of each write", async () => {
    const store = createProjectChatStore(memoryContext());
    const changed: string[] = [];
    store.onChange((dir) => changed.push(dir));
    await Promise.all([store.add(DIR, "One", "Ana"), store.add(DIR, "Two", "Bo"), store.add(DIR, "Three", "Ana")]);
    expect((await store.read(DIR)).map((message) => message.body)).toEqual(["One", "Two", "Three"]);
    expect(changed).toEqual([DIR, DIR, DIR]);
  });

  it("keeps a Windows folder's separator", () => {
    expect(projectChatFilePath("C:\\p\\thesis\\")).toBe("C:\\p\\thesis\\.labshelf\\chat.qmd");
  });
});

describe("device-local unread", () => {
  const messages = [
    { author: "Bo", created: "2026-11-09T10:00:00.000Z" },
    { author: "Ana", created: "2026-11-09T10:05:00.000Z" },
    { author: "Bo", created: "2026-11-09T10:10:00.000Z" },
  ];

  it("D5 counts messages by others after the last open, all of them when never opened", () => {
    expect(countProjectChatUnread(messages, "Ana", undefined)).toBe(2);
    expect(countProjectChatUnread(messages, "Ana", "2026-11-09T10:05:00.000Z")).toBe(1);
    expect(countProjectChatUnread(messages, "Ana", "2026-11-09T10:10:00.000Z")).toBe(0);
  });

  it("D5 moves the last open forward only", () => {
    const seen = markProjectChatSeen({}, "thesis", "2026-11-09T10:05:00.000Z");
    expect(seen).toEqual({ thesis: "2026-11-09T10:05:00.000Z" });
    expect(markProjectChatSeen(seen, "thesis", "2026-11-09T10:00:00.000Z")).toBe(seen);
    expect(markProjectChatSeen(seen, "thesis", "2026-11-09T10:10:00.000Z")).toEqual({ thesis: "2026-11-09T10:10:00.000Z" });
  });
});
