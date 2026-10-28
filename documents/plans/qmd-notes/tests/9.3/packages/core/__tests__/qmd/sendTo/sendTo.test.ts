import { createSendBody, type SendPayload } from "../../../src/qmd/sendTo/sendBody";
import { sendTo, type SendRequest, type SendTarget } from "../../../src/qmd/sendTo/sendTo";
import { createProjectNoteWriter, type IProjectAssetWriter } from "../../../src/qmd/sendTo/projectNoteWriter";
import { createRecentTargets, type IKeyValueStore } from "../../../src/qmd/sendTo/recentTargets";
import { createProjectNotesStore, type IProjectNoteFiles } from "../../../src/qmd/projectNotes/projectNotesStore";
import { parseItemFile, type ItemSegment } from "../../../src/qmd/itemFile";
import type { ILogger } from "../../../src/ports/hostPorts";

const PROJECT = "proj-1";
const ITEM_ID = "n-01JB2QN0000000000000000000";

function makeLogger(): ILogger {
  return { log: jest.fn().mockResolvedValue(undefined), error: jest.fn().mockResolvedValue(undefined) };
}

function itemsOf(text: string): ItemSegment[] {
  return parseItemFile(text).segments.filter((segment): segment is ItemSegment => segment.kind === "item");
}

/** In-memory project files that record every write in `events`. */
function memoryFiles(events: string[] = []): IProjectNoteFiles & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async list() {
      return [...files.keys()];
    },
    async read(_projectId, path) {
      return files.get(path) ?? null;
    },
    async write(_projectId, path, text) {
      events.push(`note:${path}`);
      files.set(path, text);
    },
  };
}

describe("createSendBody", () => {
  it("9.3a quote is the prefixed lines, a blank line, then the page link", () => {
    const payload: SendPayload = { kind: "quote", key: "vaswani2017", page: 3, text: "Attention is all you need." };
    expect(createSendBody(payload, ITEM_ID)).toBe(
      "> Attention is all you need.\n\n[vaswani2017, p. 3](labshelf:vaswani2017#p3)",
    );
  });

  it("9.3a quote prefixes every line of a multi-line text", () => {
    const payload: SendPayload = { kind: "quote", key: "k1", page: 12, text: "first line\nsecond line" };
    expect(createSendBody(payload, ITEM_ID)).toBe("> first line\n> second line\n\n[k1, p. 12](labshelf:k1#p12)");
  });

  it("9.3a equation is a $$ block, a blank line, then the page link", () => {
    const payload: SendPayload = { kind: "equation", key: "vaswani2017", page: 4, latex: "E = mc^2" };
    expect(createSendBody(payload, ITEM_ID)).toBe("$$\nE = mc^2\n$$\n\n[vaswani2017, p. 4](labshelf:vaswani2017#p4)");
  });

  it("9.3a figure is an image at assets/<item id>.png, a blank line, then the page link", () => {
    const payload: SendPayload = {
      kind: "figure",
      key: "vaswani2017",
      page: 5,
      image: new Uint8Array([1, 2, 3]),
      mime: "image/png",
    };
    expect(createSendBody(payload, ITEM_ID)).toBe(
      `![](assets/${ITEM_ID}.png)\n\n[vaswani2017, p. 5](labshelf:vaswani2017#p5)`,
    );
  });

  it("9.3a item is its body, a blank line, then a Source link with the source path and id", () => {
    const payload: SendPayload = { kind: "item", sourcePath: "notes/ideas.qmd", itemId: "n-01JB2QP0000000000000000000", body: "An idea." };
    expect(createSendBody(payload, ITEM_ID)).toBe("An idea.\n\n[Source](notes/ideas.qmd#n-01JB2QP0000000000000000000)");
  });
});

describe("sendTo with the project note writer", () => {
  it("9.3b creates a missing note holding one item with the injected id and the sender as author", async () => {
    const files = memoryFiles();
    const store = createProjectNotesStore(files, makeLogger());
    const assets: IProjectAssetWriter = { write: jest.fn().mockResolvedValue(undefined) };
    const send = sendTo(
      { projectNote: createProjectNoteWriter(store, assets) },
      { logger: makeLogger(), newItemId: () => ITEM_ID },
    );
    const request: SendRequest = {
      target: { kind: "projectNote", projectId: PROJECT, path: "notes/fresh.qmd" },
      payload: { kind: "quote", key: "vaswani2017", page: 3, text: "Attention is all you need." },
      sender: "Ana",
    };
    const result = await send(request);
    expect(result).toEqual({ itemId: ITEM_ID });
    const text = files.files.get("notes/fresh.qmd");
    expect(text).toBeDefined();
    const items = itemsOf(text!);
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe(ITEM_ID);
    expect(items[0]!.author).toBe("Ana");
    expect(items[0]!.body).toContain("> Attention is all you need.");
    expect(items[0]!.body).toContain("[vaswani2017, p. 3](labshelf:vaswani2017#p3)");
    expect(assets.write).not.toHaveBeenCalled();
  });

  it("9.3b a send without a sender writes an item with no author", async () => {
    const files = memoryFiles();
    const store = createProjectNotesStore(files, makeLogger());
    const send = sendTo(
      { projectNote: createProjectNoteWriter(store, { write: jest.fn().mockResolvedValue(undefined) }) },
      { logger: makeLogger(), newItemId: () => ITEM_ID },
    );
    await send({
      target: { kind: "projectNote", projectId: PROJECT, path: "notes/anon.qmd" },
      payload: { kind: "equation", key: "k", page: 1, latex: "x" },
    });
    const items = itemsOf(files.files.get("notes/anon.qmd")!);
    expect(items).toHaveLength(1);
    expect(items[0]!.author).toBeUndefined();
  });

  it("9.3b a target kind with no registered writer rejects and is logged", async () => {
    const logger = makeLogger();
    const send = sendTo({}, { logger, newItemId: () => ITEM_ID });
    await expect(
      send({
        target: { kind: "spaceNote", spaceId: "s1", path: "notes/a.qmd" },
        payload: { kind: "quote", key: "k", page: 1, text: "t" },
      }),
    ).rejects.toThrow();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe("sendTo figure sends", () => {
  const figureRequest = (path: string): SendRequest => ({
    target: { kind: "projectNote", projectId: PROJECT, path },
    payload: { kind: "figure", key: "vaswani2017", page: 5, image: new Uint8Array([9, 8, 7]), mime: "image/png" },
    sender: "Ana",
  });

  it("9.3d a rejected asset write rejects the send, leaves the note unwritten and logs one error", async () => {
    const events: string[] = [];
    const files = memoryFiles(events);
    const store = createProjectNotesStore(files, makeLogger());
    const failure = new Error("disk full");
    const assets: IProjectAssetWriter = { write: jest.fn().mockRejectedValue(failure) };
    const logger = makeLogger();
    const send = sendTo({ projectNote: createProjectNoteWriter(store, assets) }, { logger, newItemId: () => ITEM_ID });
    await expect(send(figureRequest("notes/fig.qmd"))).rejects.toBe(failure);
    expect(files.files.size).toBe(0);
    expect(events).toEqual([]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("9.3d a successful figure send writes notes/assets/<item id>.png before the item", async () => {
    const events: string[] = [];
    const files = memoryFiles(events);
    const store = createProjectNotesStore(files, makeLogger());
    const assets: IProjectAssetWriter = {
      write: jest.fn(async (_projectId: string, path: string) => {
        events.push(`asset:${path}`);
      }),
    };
    const logger = makeLogger();
    const send = sendTo({ projectNote: createProjectNoteWriter(store, assets) }, { logger, newItemId: () => ITEM_ID });
    const result = await send(figureRequest("notes/fig.qmd"));
    expect(result).toEqual({ itemId: ITEM_ID });
    expect(assets.write).toHaveBeenCalledTimes(1);
    expect(assets.write).toHaveBeenCalledWith(PROJECT, `notes/assets/${ITEM_ID}.png`, new Uint8Array([9, 8, 7]));
    expect(events).toEqual([`asset:notes/assets/${ITEM_ID}.png`, "note:notes/fig.qmd"]);
    const items = itemsOf(files.files.get("notes/fig.qmd")!);
    expect(items).toHaveLength(1);
    expect(items[0]!.body).toContain(`![](assets/${ITEM_ID}.png)`);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("createRecentTargets", () => {
  function memoryKv(initial: Record<string, unknown> = {}): IKeyValueStore & { data: Map<string, unknown> } {
    const data = new Map<string, unknown>(Object.entries(initial));
    return {
      data,
      async get(key) {
        return data.get(key);
      },
      async set(key, value) {
        data.set(key, value);
      },
    };
  }
  const target = (n: number): SendTarget => ({ kind: "projectNote", projectId: PROJECT, path: `notes/n${n}.qmd` });

  it("9.3c after 10 pushes list returns the last 8, most recent first", async () => {
    const recent = createRecentTargets(memoryKv(), "labshelf.recentTargets");
    for (let n = 1; n <= 10; n++) { await recent.push(target(n)); }
    expect(await recent.list()).toEqual([10, 9, 8, 7, 6, 5, 4, 3].map(target));
  });

  it("9.3c pushing an existing target moves it to the front without a duplicate", async () => {
    const recent = createRecentTargets(memoryKv(), "labshelf.recentTargets");
    await recent.push(target(1));
    await recent.push(target(2));
    await recent.push(target(3));
    await recent.push({ ...target(1) });
    expect(await recent.list()).toEqual([target(1), target(3), target(2)]);
  });

  it("9.3c targets of another kind or project with the same path are not equal", async () => {
    const recent = createRecentTargets(memoryKv(), "k");
    const a: SendTarget = { kind: "projectNote", projectId: "p1", path: "notes/a.qmd" };
    const b: SendTarget = { kind: "projectNote", projectId: "p2", path: "notes/a.qmd" };
    const c: SendTarget = { kind: "spaceNote", spaceId: "p1", path: "notes/a.qmd" };
    await recent.push(a);
    await recent.push(b);
    await recent.push(c);
    expect(await recent.list()).toEqual([c, b, a]);
  });

  it("9.3c a stored value that is not a valid list reads as empty", async () => {
    expect(await createRecentTargets(memoryKv({ k: "garbage" }), "k").list()).toEqual([]);
    expect(await createRecentTargets(memoryKv({ k: { a: 1 } }), "k").list()).toEqual([]);
    expect(await createRecentTargets(memoryKv({ k: [{ nope: true }] }), "k").list()).toEqual([]);
    expect(await createRecentTargets(memoryKv(), "k").list()).toEqual([]);
  });

  it("9.3c the list is stored in the key value store under the given key", async () => {
    const kv = memoryKv();
    const recent = createRecentTargets(kv, "my.key");
    await recent.push(target(1));
    expect(kv.data.has("my.key")).toBe(true);
    expect(await createRecentTargets(kv, "my.key").list()).toEqual([target(1)]);
  });
});
