/** Contract of reading an arXiv e-print: the id of a record, unpacking the bytes, and the once-only cached download. */
import { gzipSync } from "node:zlib";
import { gunzip, readTar, readTarGz } from "../../src/encoding/archive.js";
import { EPRINT_CACHE_DIR, loadEprint, unpackEprint, type EprintCache } from "../../src/equations/arxivSource.js";
import { arxivIdOfRecord } from "../../src/import/identifiers/arxiv.js";
import type { FetchLike, ILogger } from "../../src/ports/index.js";

/** One 512-byte ustar header and the padded body of each entry, closed by two empty blocks. */
function tar(entries: Array<{ name: string; body?: string | Uint8Array; type?: string }>): Uint8Array {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = typeof entry.body === "string" ? Buffer.from(entry.body) : Buffer.from(entry.body ?? []);
    const header = Buffer.alloc(512);
    header.write(entry.name, 0);
    header.write("0000644\0", 100);
    header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write(entry.type ?? "0", 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return new Uint8Array(Buffer.concat(blocks));
}

const tarGz = (entries: Parameters<typeof tar>[0]): Uint8Array => new Uint8Array(gzipSync(tar(entries)));
const bytesOf = (text: string): Uint8Array => new Uint8Array(Buffer.from(text));
const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString();
const PDF = bytesOf("%PDF-1.5\n%\u00e2\u00e3\u00cf\u00d3\n1 0 obj\n<< >>\nendobj\n");

const silentLogger: ILogger = { log: async () => undefined, error: async () => undefined };

function memoryCache(initial: Record<string, Uint8Array> = {}): EprintCache & { store: Map<string, Uint8Array>; writes: string[] } {
  const store = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    store,
    writes,
    read: async (id) => store.get(id),
    write: async (id, bytes) => { writes.push(id); store.set(id, bytes); },
  };
}

interface FakeFetch { fetch: FetchLike; calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> }

function fakeFetch(respond: () => Response): FakeFetch {
  const calls: FakeFetch["calls"] = [];
  const fetch: FetchLike = async (url, init) => { calls.push({ url, init }); return respond(); };
  return { fetch, calls };
}

const ok = (bytes: Uint8Array): (() => Response) => () => new Response(new Uint8Array(bytes), { status: 200 });

describe("unpackEprint", () => {
  it("1.1a unpacks a tar.gz into its text files keyed by path", async () => {
    const result = await unpackEprint(tarGz([
      { name: "main.tex", body: "\\documentclass{article}" },
      { name: "sections/", type: "5" },
      { name: "sections/intro.tex", body: "Intro" },
    ]));
    expect(result.kind).toBe("tex");
    if (result.kind !== "tex") { return; }
    expect([...result.files.keys()].sort()).toEqual(["main.tex", "sections/intro.tex"]);
    expect(result.files.get("sections/intro.tex")).toBe("Intro");
  });

  it("1.1a keeps only .tex, .sty, .cls, .bbl and .def files as text", async () => {
    const result = await unpackEprint(tarGz([
      { name: "a.tex", body: "a" },
      { name: "b.sty", body: "b" },
      { name: "c.cls", body: "c" },
      { name: "d.bbl", body: "d" },
      { name: "e.def", body: "e" },
      { name: "f.png", body: new Uint8Array([137, 80, 78, 71]) },
      { name: "g.bib", body: "@article{}" },
      { name: "h.pdf", body: PDF },
      { name: "README", body: "read me" },
    ]));
    expect(result.kind).toBe("tex");
    if (result.kind !== "tex") { return; }
    expect([...result.files.keys()].sort()).toEqual(["a.tex", "b.sty", "c.cls", "d.bbl", "e.def"]);
  });

  it("1.1a unpacks an uncompressed tar", async () => {
    const result = await unpackEprint(tar([{ name: "paper.tex", body: "Plain tar" }]));
    expect(result).toEqual({ kind: "tex", files: new Map([["paper.tex", "Plain tar"]]) });
  });

  it("1.1a treats a single gzipped TeX file as main.tex", async () => {
    const result = await unpackEprint(new Uint8Array(gzipSync(Buffer.from("\\documentclass{article}\n\\begin{document}x\\end{document}"))));
    expect(result).toEqual({ kind: "tex", files: new Map([["main.tex", "\\documentclass{article}\n\\begin{document}x\\end{document}"]]) });
  });

  it("1.1a treats plain TeX bytes as main.tex", async () => {
    const result = await unpackEprint(bytesOf("\\documentclass{article}\n\\begin{document}Hi\\end{document}\n"));
    expect(result).toEqual({ kind: "tex", files: new Map([["main.tex", "\\documentclass{article}\n\\begin{document}Hi\\end{document}\n"]]) });
  });

  it("1.1a reports a PDF as none with why pdf", async () => {
    expect(await unpackEprint(PDF)).toEqual({ kind: "none", why: "pdf" });
  });

  it("1.1a decodes UTF-8 text as UTF-8", async () => {
    const result = await unpackEprint(tarGz([{ name: "main.tex", body: "caf\u00e9 \u03b1" }]));
    expect(result).toEqual({ kind: "tex", files: new Map([["main.tex", "caf\u00e9 \u03b1"]]) });
  });

  it("1.1a falls back to Latin-1 when a file is not valid UTF-8", async () => {
    // 0xE9 alone is "é" in Latin-1 and an invalid UTF-8 sequence.
    const latin1 = new Uint8Array([...Buffer.from("caf"), 0xe9, ...Buffer.from(" \\alpha")]);
    const result = await unpackEprint(tarGz([{ name: "main.tex", body: latin1 }]));
    expect(result).toEqual({ kind: "tex", files: new Map([["main.tex", "caf\u00e9 \\alpha"]]) });
  });

  it("1.1a reports an archive without any text file as none with why empty", async () => {
    const result = await unpackEprint(tarGz([{ name: "fig.png", body: new Uint8Array([1, 2, 3]) }, { name: "data.bib", body: "@a{}" }]));
    expect(result).toEqual({ kind: "none", why: "empty" });
  });

  it("1.1a reports a corrupt gzip stream as none with why unreadable instead of throwing", async () => {
    const corrupt = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xde, 0xad, 0xbe, 0xef, 0xff, 0xff, 0xff, 0xff]);
    expect(await unpackEprint(corrupt)).toEqual({ kind: "none", why: "unreadable" });
  });
});

describe("loadEprint", () => {
  const ARCHIVE = tarGz([{ name: "main.tex", body: "\\documentclass{article}\n\\begin{document}x\\end{document}" }]);

  it("1.1b keeps the cache under .research/sources/arxiv", () => {
    expect(EPRINT_CACHE_DIR).toBe(".research/sources/arxiv");
  });

  it("1.1b fetches https://arxiv.org/e-print/<id>, unpacks the bytes and caches the raw bytes", async () => {
    const cache = memoryCache();
    const net = fakeFetch(ok(ARCHIVE));
    const result = await loadEprint("1706.03762", { fetch: net.fetch, cache, logger: silentLogger });
    expect(net.calls.map((c) => c.url)).toEqual(["https://arxiv.org/e-print/1706.03762"]);
    expect(result.kind).toBe("tex");
    expect(cache.store.get("1706.03762")).toEqual(ARCHIVE);
  });

  it("1.1b puts an old-style id with its slash into the URL", async () => {
    const net = fakeFetch(ok(ARCHIVE));
    await loadEprint("hep-th/9711200", { fetch: net.fetch, cache: memoryCache(), logger: silentLogger });
    expect(net.calls.map((c) => c.url)).toEqual(["https://arxiv.org/e-print/hep-th/9711200"]);
  });

  it("1.1b does not fetch a second time for the same id", async () => {
    const cache = memoryCache();
    const net = fakeFetch(ok(ARCHIVE));
    const env = { fetch: net.fetch, cache, logger: silentLogger };
    const first = await loadEprint("1706.03762", env);
    const second = await loadEprint("1706.03762", env);
    expect(net.calls).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("1.1b does not fetch when the cache already holds the id", async () => {
    const cache = memoryCache({ "2301.12345": ARCHIVE });
    const net = fakeFetch(() => { throw new Error("must not fetch"); });
    const result = await loadEprint("2301.12345", { fetch: net.fetch, cache, logger: silentLogger });
    expect(net.calls).toHaveLength(0);
    expect(result.kind).toBe("tex");
  });

  it("1.1b fetches again for a different id", async () => {
    const cache = memoryCache();
    const net = fakeFetch(ok(ARCHIVE));
    const env = { fetch: net.fetch, cache, logger: silentLogger };
    await loadEprint("1706.03762", env);
    await loadEprint("2301.12345", env);
    expect(net.calls).toHaveLength(2);
  });

  it("1.1b throws on a non-2xx response and caches nothing", async () => {
    const cache = memoryCache();
    const net = fakeFetch(() => new Response("not found", { status: 404 }));
    await expect(loadEprint("1706.03762", { fetch: net.fetch, cache, logger: silentLogger })).rejects.toThrow();
    expect(cache.writes).toEqual([]);
    expect(cache.store.size).toBe(0);
  });

  it("1.1b caches a failed-then-retried download only after it succeeds", async () => {
    const cache = memoryCache();
    let healthy = false;
    const net = fakeFetch(() => (healthy ? new Response(new Uint8Array(ARCHIVE), { status: 200 }) : new Response("busy", { status: 503 })));
    const env = { fetch: net.fetch, cache, logger: silentLogger };
    await expect(loadEprint("1706.03762", env)).rejects.toThrow();
    healthy = true;
    const result = await loadEprint("1706.03762", env);
    expect(result.kind).toBe("tex");
    expect(net.calls).toHaveLength(2);
  });

  it("1.1b caches the raw bytes of a PDF e-print and reports none with why pdf", async () => {
    const cache = memoryCache();
    const net = fakeFetch(ok(PDF));
    const env = { fetch: net.fetch, cache, logger: silentLogger };
    expect(await loadEprint("1706.03762", env)).toEqual({ kind: "none", why: "pdf" });
    expect(cache.store.get("1706.03762")).toEqual(PDF);
    expect(await loadEprint("1706.03762", env)).toEqual({ kind: "none", why: "pdf" });
    expect(net.calls).toHaveLength(1);
  });

  it("1.1b passes the headers and the abort signal to fetch", async () => {
    const net = fakeFetch(ok(ARCHIVE));
    const controller = new AbortController();
    await loadEprint("1706.03762", { fetch: net.fetch, cache: memoryCache(), logger: silentLogger, headers: { "User-Agent": "labshelf-test" } }, controller.signal);
    expect(net.calls[0]?.init?.headers).toEqual({ "User-Agent": "labshelf-test" });
    expect(net.calls[0]?.init?.signal).toBe(controller.signal);
  });

  it("A1 downloads once, then unpacks the cached bytes into the same text files", async () => {
    const cache = memoryCache();
    const net = fakeFetch(ok(tarGz([{ name: "main.tex", body: "\\documentclass{article}" }, { name: "s/a.tex", body: "A" }])));
    const env = { fetch: net.fetch, cache, logger: silentLogger };
    const first = await loadEprint("1706.03762", env);
    const second = await loadEprint("1706.03762", env);
    expect(net.calls).toHaveLength(1);
    expect(first).toEqual({ kind: "tex", files: new Map([["main.tex", "\\documentclass{article}"], ["s/a.tex", "A"]]) });
    expect(second).toEqual(first);
  });
});

describe("arxivIdOfRecord", () => {
  it("A1 reads the id from an arXiv DOI", () => {
    expect(arxivIdOfRecord({ doi: "10.48550/arXiv.1706.03762" })).toBe("1706.03762");
  });

  it("A1 falls back to the url when the doi is not an arXiv DOI", () => {
    expect(arxivIdOfRecord({ doi: "10.1000/xyz123", url: "https://arxiv.org/abs/2301.12345" })).toBe("2301.12345");
  });

  it("A1 reads the id from the url when there is no doi", () => {
    expect(arxivIdOfRecord({ url: "https://arxiv.org/pdf/1706.03762v7" })).toBe("1706.03762");
  });

  it("A1 reads an old-style id", () => {
    expect(arxivIdOfRecord({ url: "https://arxiv.org/abs/hep-th/9711200v3" })).toBe("hep-th/9711200");
  });

  it("A1 returns undefined when neither doi nor url names an arXiv paper", () => {
    expect(arxivIdOfRecord({ doi: "10.1000/xyz123", url: "https://example.org/paper" })).toBeUndefined();
    expect(arxivIdOfRecord({})).toBeUndefined();
  });
});

describe("archive reader", () => {
  it("A1 reads a tar.gz into entries with path, kind and bytes", async () => {
    const entries = await readTarGz(tarGz([{ name: "d/", type: "5" }, { name: "d/a.tex", body: "AAA" }]), 1024 * 1024);
    expect(entries.map((e) => [e.path, e.kind])).toEqual([["d", "directory"], ["d/a.tex", "file"]]);
    expect(text(entries[1]!.bytes)).toBe("AAA");
  });

  it("A1 reads an uncompressed tar with readTar", () => {
    const entries = readTar(tar([{ name: "a.tex", body: "A" }, { name: "b.tex", body: "B" }]));
    expect(entries.map((e) => [e.path, text(e.bytes)])).toEqual([["a.tex", "A"], ["b.tex", "B"]]);
  });

  it("A1 gunzips bytes", async () => {
    expect(text(await gunzip(new Uint8Array(gzipSync(Buffer.from("hello"))), 1024))).toBe("hello");
  });

  it("A1 refuses to gunzip more than maxBytes", async () => {
    const big = new Uint8Array(gzipSync(Buffer.alloc(100_000)));
    await expect(gunzip(big, 1000)).rejects.toThrow();
    await expect(readTarGz(big, 1000)).rejects.toThrow();
  });
});
