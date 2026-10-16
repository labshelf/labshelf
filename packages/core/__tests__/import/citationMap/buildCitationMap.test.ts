/** Contract of the citation map: OpenAlex works per library paper, cached with a fetch date, and the often-cited missing works. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCitationMap, openAlexWork, type IFileSystem, type RegistryEnv } from "../../../src/index";

const recorded = (name: string): object => JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8"));
const FIELDS = "select=id,doi,title,display_name,publication_year,authorships,cited_by_count,referenced_works";
const byDoi = (doi: string): string => `https://api.openalex.org/works/doi:${doi}?${FIELDS}`;
const byId = (workId: string): string => `https://api.openalex.org/works/${workId}?${FIELDS}`;
const work = (workId: string, references: string[], doi?: string): object => ({
  id: `https://openalex.org/${workId}`,
  doi: doi && `https://doi.org/${doi}`,
  title: `Work ${workId}`,
  referenced_works: references.map((ref) => `https://openalex.org/${ref}`),
});

const ATTENTION_DOI = "10.48550/arXiv.1706.03762";
const TREEBANK = "W1632114991";
// W1810943226 is in the recorded reference list of "Attention Is All You Need".
const LIBRARY_ROUTES = {
  [byDoi(ATTENTION_DOI)]: recorded("attention-by-doi.json"),
  [byDoi("10.1/b")]: work("W2", [TREEBANK, "W9"]),
  [byDoi("10.1/c")]: work("W3", [TREEBANK, "W9", "W2"]),
  [byDoi("10.1/d")]: work("W1810943226", [TREEBANK]),
  [byId(TREEBANK)]: recorded("penn-treebank-by-id.json"),
};
const PAPERS = [
  { id: "attention", doi: ATTENTION_DOI },
  { id: "b", doi: "10.1/b" },
  { id: "c", doi: "10.1/c" },
  { id: "d", doi: "10.1/d" },
  { id: "unknown", doi: "10.1/unknown" },
  { id: "no-doi" },
];

function fakeNetwork(routes: Record<string, object>): { env: RegistryEnv; calls: string[] } {
  const calls: string[] = [];
  const fetchFake = async (input: RequestInfo | URL): Promise<Response> => {
    calls.push(String(input));
    const body = routes[String(input)];
    return body === undefined ? new Response("no", { status: 404 }) : new Response(JSON.stringify(body));
  };
  return { env: { fetch: fetchFake as typeof fetch }, calls };
}

function memoryFs(): IFileSystem & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    ensureDir: async () => undefined,
    writeText: async (path, content) => void files.set(path, content),
    readText: async (path) => files.get(path) ?? "",
    exists: async (path) => files.has(path),
  };
}

const DAY = 86_400_000;
const T0 = new Date("2026-10-01T00:00:00Z");

describe("openAlexWork", () => {
  it("maps a recorded work with its DOI, counts and short reference ids", async () => {
    const { env } = fakeNetwork(LIBRARY_ROUTES);
    const result = await openAlexWork(env, { doi: ATTENTION_DOI });
    expect(result).toMatchObject({ workId: "W2626778328", title: "Attention Is All You Need", doi: "10.65215/2q58a426" });
    expect(result?.references).toHaveLength(28);
    expect(result?.references[0]).toBe(TREEBANK);
  });

  it("returns undefined for a DOI OpenAlex does not know", async () => {
    const { env } = fakeNetwork({});
    await expect(openAlexWork(env, { doi: "10.1/unknown" })).resolves.toBeUndefined();
  });
});

describe("buildCitationMap", () => {
  it("lists works cited by at least three library papers, with a display line and the citing papers", async () => {
    const { env } = fakeNetwork(LIBRARY_ROUTES);
    const map = await buildCitationMap({ registry: env, fs: memoryFs(), cacheDir: ".research/openalex", now: () => T0 }, PAPERS);
    expect(map.missing).toEqual([
      expect.objectContaining({
        workId: TREEBANK,
        title: "Building a Large Annotated Corpus of English: The Penn Treebank",
        doi: "10.21236/ada273556",
        year: 1993,
        authors: ["Mitchell P. Marcus"],
        citedBy: expect.arrayContaining(["attention", "b", "c", "d"]),
      }),
    ]);
    expect(map.links).toEqual(expect.arrayContaining([{ from: "attention", to: "d" }, { from: "c", to: "b" }]));
    expect(map.links).toHaveLength(2);
    expect(map.unresolved).toEqual(["unknown"]);
  });

  it("honours the threshold: W9 is cited by two papers", async () => {
    const { env } = fakeNetwork({ ...LIBRARY_ROUTES, [byId("W9")]: work("W9", []) });
    const map = await buildCitationMap({ registry: env, fs: memoryFs(), cacheDir: "c", now: () => T0 }, PAPERS, { minCitingPapers: 2 });
    expect(map.missing.map((missing) => missing.workId)).toEqual([TREEBANK, "W9"]);
  });

  it("leaves out a cited work whose DOI is already in the library under another OpenAlex id", async () => {
    const { env } = fakeNetwork(LIBRARY_ROUTES);
    const papers = [...PAPERS, { id: "treebank-copy", doi: "10.21236/ADA273556" }];
    const map = await buildCitationMap({ registry: env, fs: memoryFs(), cacheDir: "c", now: () => T0 }, papers);
    expect(map.missing).toEqual([]);
    expect(map.unresolved).toContain("treebank-copy");
  });

  it("answers a second run from the cache and refetches entries older than the maximum age", async () => {
    const { env, calls } = fakeNetwork(LIBRARY_ROUTES);
    const fs = memoryFs();
    const first = await buildCitationMap({ registry: env, fs, cacheDir: "c", now: () => T0 }, PAPERS);
    expect(fs.files.has("c/papers/attention.json")).toBe(true);
    expect(fs.files.has(`c/works/${TREEBANK}.json`)).toBe(true);

    calls.length = 0;
    const second = await buildCitationMap({ registry: env, fs, cacheDir: "c", now: () => new Date(T0.getTime() + 29 * DAY) }, PAPERS);
    expect(second.missing).toEqual(first.missing);
    // Only the unknown DOI is asked again: failed lookups are never cached.
    expect(calls).toEqual([byDoi("10.1/unknown")]);

    calls.length = 0;
    await buildCitationMap({ registry: env, fs, cacheDir: "c", now: () => new Date(T0.getTime() + 31 * DAY) }, PAPERS);
    expect(calls).toHaveLength(6);
  });

  it("refetches a paper whose DOI changed since it was cached", async () => {
    const { env, calls } = fakeNetwork({ ...LIBRARY_ROUTES, [byDoi("10.1/b2")]: work("W2", []) });
    const fs = memoryFs();
    await buildCitationMap({ registry: env, fs, cacheDir: "c", now: () => T0 }, PAPERS);
    calls.length = 0;
    const papers = PAPERS.map((paper) => (paper.id === "b" ? { id: "b", doi: "10.1/b2" } : paper));
    await buildCitationMap({ registry: env, fs, cacheDir: "c", now: () => T0 }, papers);
    expect(calls).toContain(byDoi("10.1/b2"));
  });

  it("treats a malformed cache file as a miss", async () => {
    const { env, calls } = fakeNetwork(LIBRARY_ROUTES);
    const fs = memoryFs();
    fs.files.set("c/papers/b.json", "{ not json");
    fs.files.set("c/papers/c.json", JSON.stringify({ fetchedAt: T0.toISOString(), work: { workId: "nope" } }));
    const map = await buildCitationMap({ registry: env, fs, cacheDir: "c", now: () => T0 }, PAPERS);
    expect(calls).toEqual(expect.arrayContaining([byDoi("10.1/b"), byDoi("10.1/c")]));
    expect(map.missing).toHaveLength(1);
  });
});
