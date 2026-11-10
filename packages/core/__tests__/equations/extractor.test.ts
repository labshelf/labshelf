/** Contract of the equation extractor: ordered sources with fall-through, offers when none answers, and the arXiv source. */
import { createArxivEquationSource } from "../../src/equations/arxivEquationSource.js";
import { createEquationExtractor, type EquationOffers, type EquationSource } from "../../src/equations/extractor.js";
import type { EprintCache } from "../../src/equations/arxivSource.js";
import type { EquationRequest } from "../../src/reader/hostPorts.js";
import type { FetchLike, ILogger } from "../../src/ports/index.js";

type Read = EquationSource["read"];
type Answer = Awaited<ReturnType<Read>>;

function makeLogger(): ILogger & { calls: number } {
  const logger = {
    calls: 0,
    log: async () => { logger.calls++; },
    error: async () => { logger.calls++; },
  };
  return logger as ILogger & { calls: number };
}

const request = (overrides: Partial<EquationRequest> = {}): EquationRequest => ({
  paperId: "paper-1",
  pageNumber: 3,
  rect: { x0: 10, x1: 200, yTop: 300, yBottom: 250 },
  text: "E = mc2 (1)",
  png: new Uint8Array([137, 80, 78, 71]),
  ...overrides,
});

interface FakeSource extends EquationSource { reads: number; checks: number }

function fakeSource(id: EquationSource["id"], behaviour: { available?: boolean | "throw"; read?: Answer | "throw" | (() => Promise<Answer>) }): FakeSource {
  const source: FakeSource = {
    id,
    reads: 0,
    checks: 0,
    available: async () => {
      source.checks++;
      if (behaviour.available === "throw") { throw new Error(`${id} availability exploded`); }
      return behaviour.available ?? true;
    },
    read: async () => {
      source.reads++;
      if (behaviour.read === "throw") { throw new Error(`${id} exploded`); }
      if (typeof behaviour.read === "function") { return behaviour.read(); }
      return behaviour.read;
    },
  };
  return source;
}

const offers = (pix2tex: Awaited<ReturnType<EquationOffers["pix2tex"]>> = "none", aiKey = false): EquationOffers => ({ pix2tex: async () => pix2tex, aiKey: () => aiKey });
const noProgress = (): void => undefined;

describe("createEquationExtractor", () => {
  it("3.1a returns the LaTeX of the first source that has some, tagged with that source", async () => {
    const arxiv = fakeSource("arxiv", { read: { latex: "E = mc^2", number: "1", label: "eq:e" } });
    const pix = fakeSource("pix2tex", { read: { latex: "wrong" } });
    const port = createEquationExtractor({ sources: [arxiv, pix], offers: offers(), logger: makeLogger() });
    const outcome = await port.extract(request(), noProgress);
    expect(outcome).toEqual({ kind: "latex", latex: "E = mc^2", source: "arxiv", number: "1", label: "eq:e" });
    expect(pix.reads).toBe(0);
  });

  it("3.1a carries the provider of an AI answer", async () => {
    const ai = fakeSource("ai", { read: { latex: "x^2", provider: "anthropic" } });
    const port = createEquationExtractor({ sources: [ai], offers: offers(), logger: makeLogger() });
    expect(await port.extract(request(), noProgress)).toMatchObject({ kind: "latex", latex: "x^2", source: "ai", provider: "anthropic" });
  });

  it("3.1a falls through a source that is not available without reading it", async () => {
    const arxiv = fakeSource("arxiv", { available: false, read: { latex: "never" } });
    const pix = fakeSource("pix2tex", { read: { latex: "a+b" } });
    const port = createEquationExtractor({ sources: [arxiv, pix], offers: offers(), logger: makeLogger() });
    const outcome = await port.extract(request(), noProgress);
    expect(outcome).toMatchObject({ kind: "latex", latex: "a+b", source: "pix2tex" });
    expect(arxiv.reads).toBe(0);
  });

  it("3.1a falls through a source that finds nothing", async () => {
    const arxiv = fakeSource("arxiv", { read: undefined });
    const pix = fakeSource("pix2tex", { read: { latex: "a+b" } });
    const port = createEquationExtractor({ sources: [arxiv, pix], offers: offers(), logger: makeLogger() });
    expect(await port.extract(request(), noProgress)).toMatchObject({ kind: "latex", source: "pix2tex" });
  });

  it("3.1a logs and skips a source whose read throws", async () => {
    const logger = makeLogger();
    const arxiv = fakeSource("arxiv", { read: "throw" });
    const pix = fakeSource("pix2tex", { read: { latex: "a+b" } });
    const port = createEquationExtractor({ sources: [arxiv, pix], offers: offers(), logger });
    expect(await port.extract(request(), noProgress)).toMatchObject({ kind: "latex", latex: "a+b", source: "pix2tex" });
    expect(logger.calls).toBeGreaterThan(0);
  });

  it("3.1a skips a source whose availability check throws", async () => {
    const arxiv = fakeSource("arxiv", { available: "throw", read: { latex: "never" } });
    const ai = fakeSource("ai", { read: { latex: "c" } });
    const port = createEquationExtractor({ sources: [arxiv, ai], offers: offers(), logger: makeLogger() });
    expect(await port.extract(request(), noProgress)).toMatchObject({ kind: "latex", latex: "c", source: "ai" });
  });

  it("3.1a answers unavailable with the offers when no source produced LaTeX", async () => {
    const port = createEquationExtractor({
      sources: [fakeSource("arxiv", { read: undefined }), fakeSource("pix2tex", { available: false })],
      offers: offers("install", true),
      logger: makeLogger(),
    });
    expect(await port.extract(request(), noProgress)).toEqual({ kind: "unavailable", offers: { pix2tex: "install", aiKey: true } });
  });

  it("3.1a answers unavailable, not failed, when every source threw", async () => {
    const port = createEquationExtractor({
      sources: [fakeSource("arxiv", { read: "throw" }), fakeSource("ai", { read: "throw" })],
      offers: offers("none", false),
      logger: makeLogger(),
    });
    expect(await port.extract(request(), noProgress)).toEqual({ kind: "unavailable", offers: { pix2tex: "none", aiKey: false } });
  });

  it("3.1a answers unavailable for an empty source list", async () => {
    const port = createEquationExtractor({ sources: [], offers: offers("installHelper", false), logger: makeLogger() });
    expect(await port.extract(request(), noProgress)).toEqual({ kind: "unavailable", offers: { pix2tex: "installHelper", aiKey: false } });
  });

  it("3.1a returns failed cancelled when the signal is already aborted", async () => {
    const arxiv = fakeSource("arxiv", { read: { latex: "x" } });
    const port = createEquationExtractor({ sources: [arxiv], offers: offers(), logger: makeLogger() });
    const controller = new AbortController();
    controller.abort();
    expect(await port.extract(request(), noProgress, controller.signal)).toEqual({ kind: "failed", reason: "cancelled" });
    expect(arxiv.reads).toBe(0);
  });

  it("3.1a returns failed cancelled when the signal aborts during a source and tries no further source", async () => {
    const controller = new AbortController();
    const first = fakeSource("arxiv", { read: async () => { controller.abort(); throw new Error("aborted"); } });
    const second = fakeSource("pix2tex", { read: { latex: "x" } });
    const port = createEquationExtractor({ sources: [first, second], offers: offers(), logger: makeLogger() });
    expect(await port.extract(request(), noProgress, controller.signal)).toEqual({ kind: "failed", reason: "cancelled" });
    expect(second.reads).toBe(0);
  });

  it("A5 tries the sources in the order given", async () => {
    const order: string[] = [];
    const make = (id: EquationSource["id"]): EquationSource => ({
      id,
      available: async () => true,
      read: async () => { order.push(id); return undefined; },
    });
    const port = createEquationExtractor({ sources: [make("arxiv"), make("pix2tex"), make("ai")], offers: offers(), logger: makeLogger() });
    await port.extract(request(), noProgress);
    expect(order).toEqual(["arxiv", "pix2tex", "ai"]);
  });

  it("A5 stops at the first source with LaTeX and leaves later ones untouched", async () => {
    const arxiv = fakeSource("arxiv", { read: undefined });
    const pix = fakeSource("pix2tex", { read: { latex: "p" } });
    const ai = fakeSource("ai", { read: { latex: "a" } });
    const port = createEquationExtractor({ sources: [arxiv, pix, ai], offers: offers(), logger: makeLogger() });
    expect(await port.extract(request(), noProgress)).toMatchObject({ source: "pix2tex" });
    expect(ai.reads).toBe(0);
    expect(ai.checks).toBe(0);
  });

  it("A5 reads the offers when asked, with the pix2tex state and the key state", async () => {
    const port = createEquationExtractor({ sources: [], offers: offers("installHelper", true), logger: makeLogger() });
    expect(await port.extract(request(), noProgress)).toEqual({ kind: "unavailable", offers: { pix2tex: "installHelper", aiKey: true } });
  });

  it("A5 never shows a failure of an early source as the final result while a later source answers", async () => {
    const port = createEquationExtractor({
      sources: [fakeSource("arxiv", { read: "throw" }), fakeSource("pix2tex", { read: "throw" }), fakeSource("ai", { read: { latex: "z" } })],
      offers: offers(),
      logger: makeLogger(),
    });
    expect(await port.extract(request(), noProgress)).toMatchObject({ kind: "latex", latex: "z", source: "ai" });
  });
});

const PAPER = [
  "\\documentclass{article}",
  "\\begin{document}",
  "Energy.",
  "\\begin{equation}\\label{eq:energy}",
  "E = m c^2",
  "\\end{equation}",
  "Then",
  "\\begin{equation}",
  "F = m a",
  "\\end{equation}",
  "\\end{document}",
  "",
].join("\n");

function memoryCache(): EprintCache & { store: Map<string, Uint8Array> } {
  const store = new Map<string, Uint8Array>();
  return { store, read: async (id) => store.get(id), write: async (id, bytes) => { store.set(id, bytes); } };
}

function fakeFetch(tex: string): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetch: FetchLike = async (url) => { urls.push(url); return new Response(new Uint8Array(Buffer.from(tex)), { status: 200 }); };
  return { fetch, urls };
}

const ARXIV_RECORD = { doi: "10.48550/arXiv.1706.03762" };

describe("createArxivEquationSource", () => {
  it("3.1b returns the equation whose number the box shows, with its number and label", async () => {
    const net = fakeFetch(PAPER);
    const source = createArxivEquationSource({ recordOf: async () => ARXIV_RECORD, fetch: net.fetch, cache: memoryCache(), logger: makeLogger() });
    const answer = await source.read(request({ text: "E = mc2 (1)" }), noProgress);
    expect(answer).toBeDefined();
    expect(answer?.latex).toContain("m c^2");
    expect(answer?.latex).not.toContain("\\label");
    expect(answer?.number).toBe("1");
    expect(answer?.label).toBe("eq:energy");
    expect(net.urls).toEqual(["https://arxiv.org/e-print/1706.03762"]);
  });

  it("3.1b returns the other equation for its own number, without a label it does not have", async () => {
    const source = createArxivEquationSource({ recordOf: async () => ARXIV_RECORD, fetch: fakeFetch(PAPER).fetch, cache: memoryCache(), logger: makeLogger() });
    const answer = await source.read(request({ text: "F = ma (2)" }), noProgress);
    expect(answer?.latex).toContain("F = m a");
    expect(answer?.number).toBe("2");
    expect(answer?.label).toBeUndefined();
  });

  it("3.1b matches by the text of the box when it carries no number", async () => {
    const source = createArxivEquationSource({ recordOf: async () => ARXIV_RECORD, fetch: fakeFetch(PAPER).fetch, cache: memoryCache(), logger: makeLogger() });
    const answer = await source.read(request({ text: "F = ma" }), noProgress);
    expect(answer?.latex).toContain("F = m a");
    expect(answer?.number).toBe("2");
  });

  it("3.1b asks for the record of the requested paper", async () => {
    const asked: string[] = [];
    const source = createArxivEquationSource({
      recordOf: async (id) => { asked.push(id); return ARXIV_RECORD; },
      fetch: fakeFetch(PAPER).fetch,
      cache: memoryCache(),
      logger: makeLogger(),
    });
    await source.read(request({ paperId: "paper-xyz", text: "(1)" }), noProgress);
    expect(asked).toEqual(["paper-xyz"]);
  });

  it("3.1b returns undefined without downloading for a paper that is not on arXiv", async () => {
    const net = fakeFetch(PAPER);
    const source = createArxivEquationSource({ recordOf: async () => ({ doi: "10.1000/xyz123", url: "https://example.org/p.pdf" }), fetch: net.fetch, cache: memoryCache(), logger: makeLogger() });
    expect(await source.read(request(), noProgress)).toBeUndefined();
    expect(net.urls).toEqual([]);
  });

  it("3.1b returns undefined for an unknown paper record", async () => {
    const net = fakeFetch(PAPER);
    const source = createArxivEquationSource({ recordOf: async () => undefined, fetch: net.fetch, cache: memoryCache(), logger: makeLogger() });
    expect(await source.read(request(), noProgress)).toBeUndefined();
    expect(net.urls).toEqual([]);
  });

  it("3.1b returns undefined when no equation matches the box", async () => {
    const source = createArxivEquationSource({ recordOf: async () => ARXIV_RECORD, fetch: fakeFetch(PAPER).fetch, cache: memoryCache(), logger: makeLogger() });
    expect(await source.read(request({ text: "completely unrelated prose words (9)" }), noProgress)).toBeUndefined();
  });

  it("3.1b reports a paper that is not on arXiv as not available", async () => {
    const source = createArxivEquationSource({ recordOf: async () => ({ url: "https://example.org/p.pdf" }), fetch: fakeFetch(PAPER).fetch, cache: memoryCache(), logger: makeLogger() });
    expect(await source.available(request())).toBe(false);
  });

  it("3.1b reports an arXiv paper as available", async () => {
    const source = createArxivEquationSource({ recordOf: async () => ARXIV_RECORD, fetch: fakeFetch(PAPER).fetch, cache: memoryCache(), logger: makeLogger() });
    expect(await source.available(request())).toBe(true);
  });

  it("3.1b loads a paper once for the session even when the cache keeps nothing", async () => {
    const net = fakeFetch(PAPER);
    const forgetful: EprintCache = { read: async () => undefined, write: async () => undefined };
    const source = createArxivEquationSource({ recordOf: async () => ARXIV_RECORD, fetch: net.fetch, cache: forgetful, logger: makeLogger() });
    await source.read(request({ text: "(1)" }), noProgress);
    await source.read(request({ text: "(2)" }), noProgress);
    expect(net.urls).toHaveLength(1);
  });

  it("A5 works through the extractor: the arXiv source wins, and an unmatched box falls to unavailable with offers", async () => {
    const source = createArxivEquationSource({ recordOf: async () => ARXIV_RECORD, fetch: fakeFetch(PAPER).fetch, cache: memoryCache(), logger: makeLogger() });
    const port = createEquationExtractor({ sources: [source], offers: offers("install", false), logger: makeLogger() });
    expect(await port.extract(request({ text: "E = mc2 (1)" }), noProgress)).toMatchObject({ kind: "latex", source: "arxiv", number: "1", label: "eq:energy" });
    expect(await port.extract(request({ text: "completely unrelated prose words (9)" }), noProgress)).toEqual({ kind: "unavailable", offers: { pix2tex: "install", aiKey: false } });
  });
});
