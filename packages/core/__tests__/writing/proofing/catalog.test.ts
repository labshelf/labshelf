import { DICTIONARY_CATALOG, dictionaryUrls, fetchDictionary, frequencyCode, frequencyUrl } from "../../../src/writing/proofing/catalog.js";
import type { DictionaryFetch } from "../../../src/writing/proofing/catalog.js";

// Every non-null tag the language table of language.ts can return.
const LANGUAGE_TABLE_TAGS = [
  "en-US", "pt-BR", "en-GB", "en-AU", "en-CA", "pt-PT", "fr", "de", "de-AT", "de-CH", "es", "es-MX", "it", "nl",
  "pl", "ru", "uk", "ca", "cs", "da", "sv", "nb", "nn", "el", "el-polyton", "tr", "ro", "hu", "bg", "br", "cy",
  "eo", "et", "eu", "fa", "fo", "fy", "ga", "gd", "gl", "he", "hr",
];

function fakeFetch(status: number, body: string): DictionaryFetch {
  return async () => ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer });
}

describe("dictionary catalog", () => {
  it("covers every tag the language table can return, with unique tags", () => {
    const tags = DICTIONARY_CATALOG.map((entry) => entry.tag);
    expect(new Set(tags).size).toBe(tags.length);
    for (const tag of LANGUAGE_TABLE_TAGS) { expect(tags).toContain(tag); }
  });

  it("bundles only en-US and pt-BR", () => {
    expect(DICTIONARY_CATALOG.filter((entry) => entry.bundled).map((entry) => entry.tag).sort()).toEqual(["en-US", "pt-BR"]);
    expect(DICTIONARY_CATALOG.find((entry) => entry.tag === "pt-BR")).toMatchObject({ package: "dictionary-pt", version: "4.0.0" });
  });

  it("builds pinned jsDelivr URLs", () => {
    expect(dictionaryUrls("fr")).toEqual({
      aff: "https://cdn.jsdelivr.net/npm/dictionary-fr@3.0.0/index.aff",
      dic: "https://cdn.jsdelivr.net/npm/dictionary-fr@3.0.0/index.dic",
    });
  });

  it("throws for an unknown tag", () => {
    expect(() => dictionaryUrls("xx-YY")).toThrow(/xx-YY/);
  });
});

describe("fetchDictionary", () => {
  it("returns both files", async () => {
    const urls: string[] = [];
    const fetchFn: DictionaryFetch = async (url) => { urls.push(url); return fakeFetch(200, url.endsWith(".aff") ? "SET UTF-8" : "1\nword")(url); };
    const files = await fetchDictionary("de", fetchFn);
    expect(new TextDecoder().decode(files.aff)).toBe("SET UTF-8");
    expect(new TextDecoder().decode(files.dic)).toBe("1\nword");
    expect(urls.sort()).toEqual(["https://cdn.jsdelivr.net/gh/hermitdave/FrequencyWords@525f9b560de45753a5ea01069454e72e9aa541c6/content/2018/de/de_50k.txt", "https://cdn.jsdelivr.net/npm/dictionary-de@3.0.0/index.aff", "https://cdn.jsdelivr.net/npm/dictionary-de@3.0.0/index.dic"].sort());
  });

  it("throws a readable error on 404", async () => {
    await expect(fetchDictionary("fr", fakeFetch(404, "Not found"))).rejects.toThrow(/404/);
  });

  it("throws on an empty body", async () => {
    await expect(fetchDictionary("fr", fakeFetch(200, ""))).rejects.toThrow(/empty/);
  });

  it("throws a readable error when the network fails", async () => {
    const failing: DictionaryFetch = async () => { throw new Error("offline"); };
    await expect(fetchDictionary("fr", failing)).rejects.toThrow(/Could not download.*offline/);
  });

  it("rejects an unknown tag", async () => {
    await expect(fetchDictionary("xx", fakeFetch(200, "x"))).rejects.toThrow(/xx/);
  });
});

describe("word frequency lists", () => {
  it("maps tags to FrequencyWords codes", () => {
    expect(frequencyCode("pt-BR")).toBe("pt_br");
    expect(frequencyCode("pt-PT")).toBe("pt");
    expect(frequencyCode("en-GB")).toBe("en");
    expect(frequencyCode("es-MX")).toBe("es");
    expect(frequencyCode("nb")).toBe("no");
    expect(frequencyCode("cy")).toBeNull();
    expect(frequencyUrl("fr")).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/gh\/hermitdave\/FrequencyWords@[0-9a-f]{40}\/content\/2018\/fr\/fr_50k\.txt$/);
    expect(frequencyUrl("cy")).toBeNull();
  });

  const answer = (status: number, body = "x 1") => ({ ok: status === 200, status, arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer });

  it("downloads the frequency list with the dictionary", async () => {
    const files = await fetchDictionary("fr", async (url) => answer(200, url.endsWith("_50k.txt") ? "le 10" : "data"));
    expect(new TextDecoder().decode(files.freq)).toBe("le 10");
  });

  it("installs without a frequency list when its download fails", async () => {
    const files = await fetchDictionary("fr", async (url) => answer(url.endsWith("_50k.txt") ? 404 : 200));
    expect(files.freq).toBeUndefined();
    expect(files.dic.byteLength).toBeGreaterThan(0);
  });
});
