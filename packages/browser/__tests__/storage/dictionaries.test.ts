/** Pins the browser dictionary store: bundled tags read by relative URL, downloads kept in IndexedDB across reopening, a failed download storing nothing, and user words persisting. */
import "fake-indexeddb/auto";
import type { DictionaryFetch, ILogger } from "@labshelf/core";
import { IdbDictionaryStore } from "../../src/storage/dictionaries";

const BASE = "chrome-extension://abc/libraryPage/index.html";
const logger = (): ILogger => ({ log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) });
const body = (text: string) => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer });

function fakeFetch(): jest.MockedFunction<DictionaryFetch> {
  return jest.fn(async (url: string) => body(`bytes of ${url}`));
}

const store = (fetchFn: DictionaryFetch) => new IdbDictionaryStore({ fetchFn, baseUrl: BASE, logger: logger() });
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("IdbDictionaryStore dictionaries", () => {
  it("lists the bundled tags and, after an install, the installed one", async () => {
    const dictionaries = store(fakeFetch());
    expect(await dictionaries.list()).toEqual(expect.arrayContaining(["en-US", "pt-BR"]));
    expect(await dictionaries.list()).not.toContain("fr");
    await dictionaries.install("fr");
    expect(await dictionaries.list()).toEqual(expect.arrayContaining(["en-US", "pt-BR", "fr"]));
  });

  it("reads an installed dictionary from a new store instance", async () => {
    const fetchFn = fakeFetch();
    await store(fetchFn).install("de");
    const files = await store(fakeFetch()).read("de");
    expect(text(files!.aff)).toBe("bytes of https://cdn.jsdelivr.net/npm/dictionary-de@3.0.0/index.aff");
    expect(text(files!.dic)).toBe("bytes of https://cdn.jsdelivr.net/npm/dictionary-de@3.0.0/index.dic");
  });

  it("stores nothing when a download fails", async () => {
    const failing: DictionaryFetch = jest.fn(async (url: string) => (url.endsWith(".dic") ? { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) } : body("aff")));
    const dictionaries = store(failing);
    await expect(dictionaries.install("es")).rejects.toThrow(/404/);
    expect(await dictionaries.read("es")).toBeNull();
    expect(await dictionaries.list()).not.toContain("es");
  });

  it("reads a bundled dictionary by a URL relative to the page", async () => {
    const fetchFn = fakeFetch();
    const files = await store(fetchFn).read("en-US");
    expect(fetchFn).toHaveBeenCalledWith("chrome-extension://abc/libraryPage/dictionaries/en-US/index.aff");
    expect(text(files!.dic)).toContain("dictionaries/en-US/index.dic");
  });

  it("answers null for a bundled dictionary the build lacks and for an unknown tag", async () => {
    const missing: DictionaryFetch = async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });
    expect(await store(missing).read("pt-BR")).toBeNull();
    expect(await store(fakeFetch()).read("xx")).toBeNull();
  });
});

describe("IdbDictionaryStore user words", () => {
  it("keeps added words after reopening, in the order added, without repeats", async () => {
    const first = store(fakeFetch());
    await first.addUserWord("zebrafish");
    await first.addUserWord("  Labshelf ");
    await first.addUserWord("zebrafish");
    expect(await store(fakeFetch()).userWords()).toEqual(["zebrafish", "Labshelf"]);
  });

  it("rejects an empty word and a word with a line break", async () => {
    const dictionaries = store(fakeFetch());
    await expect(dictionaries.addUserWord("  ")).rejects.toThrow();
    await expect(dictionaries.addUserWord("two\nwords")).rejects.toThrow();
  });
});

describe("IdbDictionaryStore frequency lists", () => {
  it("reads a bundled tag's frequency list beside its dictionary", async () => {
    const fetchFn = fakeFetch();
    const files = await store(fetchFn).read("pt-BR");
    expect(text(files!.freq!)).toContain("dictionaries/pt-BR/frequency.txt");
  });

  it("reads a bundled dictionary without a frequency list the build lacks", async () => {
    const fetchFn = jest.fn(async (url: string) => (url.endsWith("frequency.txt") ? { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) } : body(url)));
    const files = await store(fetchFn).read("en-US");
    expect(files?.dic).toBeDefined();
    expect(files?.freq).toBeUndefined();
  });

  it("stores the downloaded frequency list, and installs without it on a 404", async () => {
    await store(fakeFetch()).install("it");
    expect(text((await store(fakeFetch()).read("it"))!.freq!)).toContain("it_50k.txt");
    const noList = jest.fn(async (url: string) => (url.endsWith("_50k.txt") ? { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) } : body(url)));
    await store(noList).install("nl");
    const nl = await store(fakeFetch()).read("nl");
    expect(nl?.dic).toBeDefined();
    expect(nl?.freq).toBeUndefined();
  });
});
