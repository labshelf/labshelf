// Tests the extension host's dictionary store over temporary folders and a fake fetch: the bundled and installed lists, atomic installs and the user's words.
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NodeDictionaryStore } from "../../../src/writing/sourceEditor/node/dictionaryStore";

const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

let root: string;
let bundledDir: string;
let storageDir: string;

async function bundle(tag: string): Promise<void> {
  await mkdir(join(bundledDir, tag), { recursive: true });
  await writeFile(join(bundledDir, tag, "index.aff"), `aff ${tag}`);
  await writeFile(join(bundledDir, tag, "index.dic"), `dic ${tag}`);
}

const okFetch = jest.fn(async (url: string) => ({
  ok: true, status: 200, arrayBuffer: async () => bytes(url.endsWith(".aff") ? "SET UTF-8" : "1\nbonjour").buffer as ArrayBuffer,
}));
const notFoundFetch = jest.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }));

function create(fetchFn: typeof okFetch | typeof notFoundFetch = okFetch): NodeDictionaryStore {
  return new NodeDictionaryStore({ bundledDir, storageDir, fetchFn: fetchFn as never, logger: logger as never });
}

beforeEach(async () => {
  jest.clearAllMocks();
  root = await mkdtemp(join(tmpdir(), "labshelf-dictionaries-"));
  bundledDir = join(root, "dist", "dictionaries");
  storageDir = join(root, "global", "dictionaries");
  await bundle("en-US");
  await bundle("pt-BR");
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("dictionaries", () => {
  it("3.2a lists the bundled tags, then an installed one after install", async () => {
    const store = create();
    expect(await store.list()).toEqual(["en-US", "pt-BR"]);
    await store.install("fr");
    expect(await store.list()).toEqual(["en-US", "fr", "pt-BR"]);
    const files = await store.read("fr");
    expect(new TextDecoder().decode(files?.aff)).toBe("SET UTF-8");
    expect(new TextDecoder().decode(files?.dic)).toBe("1\nbonjour");
  });

  it("3.2a a 404 leaves no fr folder, no partial one and throws a readable error", async () => {
    const store = create(notFoundFetch);
    await expect(store.install("fr")).rejects.toThrow(/404/);
    expect(await store.list()).toEqual(["en-US", "pt-BR"]);
    expect(await store.read("fr")).toBeNull();
    expect(await readdir(storageDir).catch(() => [])).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith("writing/sourceEditor", expect.anything(), expect.objectContaining({ action: "installDictionary", tag: "fr" }));
  });

  it("3.2a installing a bundled tag downloads nothing", async () => {
    await create().install("en-US");
    expect(okFetch).not.toHaveBeenCalled();
  });

  it("3.2a an installed tag is not downloaded again", async () => {
    const store = create();
    await store.install("fr");
    okFetch.mockClear();
    await store.install("fr");
    expect(okFetch).not.toHaveBeenCalled();
  });

  it("reads a bundled dictionary and answers null for an unknown tag", async () => {
    const store = create();
    expect(new TextDecoder().decode((await store.read("pt-BR"))?.dic)).toBe("dic pt-BR");
    expect(await store.read("de")).toBeNull();
  });

  it("refuses a tag that is not a language tag", async () => {
    const store = create();
    await expect(store.read("../global")).rejects.toThrow(/language tag/);
    await expect(store.install("../x")).rejects.toThrow(/language tag/);
  });

  it("lists only folders that hold both files", async () => {
    await mkdir(join(storageDir, "de"), { recursive: true });
    await writeFile(join(storageDir, "de", "index.aff"), "x");
    expect(await create().list()).toEqual(["en-US", "pt-BR"]);
  });
});

describe("user words", () => {
  it("3.2b persists a word to words.txt and a new store instance reads it", async () => {
    await create().addUserWord("labshelf");
    expect(await readFile(join(storageDir, "words.txt"), "utf8")).toBe("labshelf\n");
    expect(await create().userWords()).toEqual(["labshelf"]);
  });

  it("3.2b has no words before any is added", async () => {
    expect(await create().userWords()).toEqual([]);
  });

  it("3.2b keeps each word once, in order, even when added together", async () => {
    const store = create();
    await Promise.all([store.addUserWord("alpha"), store.addUserWord("beta"), store.addUserWord("alpha")]);
    expect(await store.userWords()).toEqual(["alpha", "beta"]);
  });

  it("3.2b refuses an empty word and a word with a line break", async () => {
    const store = create();
    await expect(store.addUserWord("  ")).rejects.toThrow();
    await expect(store.addUserWord("a\nb")).rejects.toThrow();
    expect(await store.userWords()).toEqual([]);
  });
});
