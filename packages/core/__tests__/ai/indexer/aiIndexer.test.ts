// The indexer reads each PDF once, skips unchanged content, survives failing jobs and clears deleted papers.
import { AiIndexer } from "../../../src/ai/indexer/aiIndexer";
import type { AiIndexerDependencies } from "../../../src/ai/indexer/aiIndexer";
import { sha256Hex } from "../../../src/hash/index";

jest.mock("../../../src/ai/pipeline/index", () => ({
  ...jest.requireActual("../../../src/ai/pipeline/index"),
  runIngestion: jest.fn(async () => ({ chunkCount: 1, embeddedChunks: 1 })),
}));

const BYTES = new Uint8Array([1, 2, 3]);

function makeIndexer(options: {
  resolvePdfPath?: AiIndexerDependencies["resolvePdfPath"];
  papers?: Array<{ id: string }>;
  stored?: Record<string, string>;
} = {}) {
  const stored = new Map(Object.entries(options.stored ?? {}));
  const handlers: { upsert: Array<(id: string) => void>; remove: Array<(id: string) => void> } = { upsert: [], remove: [] };
  const deps = {
    listPapers: jest.fn(async () => options.papers ?? [{ id: "p1" }]),
    subscribe: jest.fn((onUpsert: (id: string) => void, onRemove: (id: string) => void) => {
      handlers.upsert.push(onUpsert);
      handlers.remove.push(onRemove);
      return () => { handlers.upsert.length = 0; handlers.remove.length = 0; };
    }),
    logger: { error: jest.fn(async () => {}), log: jest.fn(async () => {}) },
    embedder: {},
    vectorStore: { deleteByPaper: jest.fn(async () => {}) },
    hashes: {
      get: jest.fn((id: string) => stored.get(id) ?? null),
      set: jest.fn((id: string, hash: string) => { stored.set(id, hash); }),
      delete: jest.fn((id: string) => { stored.delete(id); }),
    },
    extractor: { extract: jest.fn(async () => ({})) },
    resolvePdfPath: options.resolvePdfPath ?? (async (id: string) => `/lib/papers/${id}/paper.pdf`),
    fileSystem: { readFile: jest.fn(async () => BYTES) },
  };
  const indexer = new AiIndexer(deps as unknown as AiIndexerDependencies);
  // rebuildAll resolves once every job it queued has finished, so an empty rebuild also flushes earlier jobs.
  const flush = async () => { deps.listPapers.mockResolvedValueOnce([]); await indexer.rebuildAll(); };
  const fire = { upsert: (id: string) => handlers.upsert.forEach((h) => h(id)), remove: (id: string) => handlers.remove.forEach((h) => h(id)) };
  return { indexer, deps, stored, flush, fire };
}

describe("AiIndexer indexing", () => {
  it("reads the PDF once from wherever the resolver says it lives and stores its SHA-256", async () => {
    const nested = "/lib/papers/Project/Refs/p1/paper.pdf";
    const { indexer, deps, stored } = makeIndexer({ resolvePdfPath: async () => nested });

    await indexer.rebuildAll();

    expect(deps.fileSystem.readFile).toHaveBeenCalledTimes(1);
    expect(deps.fileSystem.readFile).toHaveBeenCalledWith(nested);
    expect(deps.extractor.extract).toHaveBeenCalledWith("p1", BYTES);
    expect(stored.get("p1")).toBe(await sha256Hex(BYTES));
  });

  it("skips a paper whose content hash matches the stored one", async () => {
    const { indexer, deps } = makeIndexer({ stored: { p1: await sha256Hex(BYTES) } });

    await indexer.rebuildAll();

    expect(deps.extractor.extract).not.toHaveBeenCalled();
    expect(deps.hashes.set).not.toHaveBeenCalled();
  });

  it("re-indexes a paper whose content changed", async () => {
    const { indexer, deps, stored } = makeIndexer({ stored: { p1: "stale" } });

    await indexer.rebuildAll();

    expect(deps.extractor.extract).toHaveBeenCalledTimes(1);
    expect(stored.get("p1")).toBe(await sha256Hex(BYTES));
  });

  it("skips a paper the resolver cannot locate", async () => {
    const { indexer, deps } = makeIndexer({ resolvePdfPath: async () => null });

    await indexer.rebuildAll();

    expect(deps.fileSystem.readFile).not.toHaveBeenCalled();
  });

  it("logs a failing job with its paper id and still runs the next one", async () => {
    const { indexer, deps, stored } = makeIndexer({ papers: [{ id: "bad" }, { id: "good" }] });
    deps.extractor.extract.mockRejectedValueOnce(new Error("corrupt pdf"));

    await indexer.rebuildAll();

    expect(deps.logger.error).toHaveBeenCalledWith("ai/indexer", expect.objectContaining({ message: "corrupt pdf" }), { paperId: "bad" });
    expect(stored.has("bad")).toBe(false);
    expect(stored.has("good")).toBe(true);
  });

  it("logs a resolver that throws instead of breaking the queue", async () => {
    const { indexer, deps, stored } = makeIndexer({
      papers: [{ id: "bad" }, { id: "good" }],
      resolvePdfPath: async (id) => { if (id === "bad") throw new Error("index locked"); return "/p.pdf"; },
    });

    await indexer.rebuildAll();

    expect(deps.logger.error).toHaveBeenCalledWith("ai/indexer", expect.objectContaining({ message: "index locked" }), { paperId: "bad" });
    expect(stored.has("good")).toBe(true);
  });
});

describe("AiIndexer paper deletion", () => {
  it("removes the paper's vectors and hash row", async () => {
    const { indexer, deps, stored, flush, fire } = makeIndexer({ stored: { p1: "h" } });
    indexer.attach();

    fire.remove("p1");
    await flush();

    expect(deps.vectorStore.deleteByPaper).toHaveBeenCalledWith("p1");
    expect(stored.has("p1")).toBe(false);
  });

  it("logs a failing vector delete", async () => {
    const { indexer, deps, flush, fire } = makeIndexer();
    deps.vectorStore.deleteByPaper.mockRejectedValueOnce(new Error("db closed"));
    indexer.attach();

    fire.remove("p1");
    await flush();

    expect(deps.logger.error).toHaveBeenCalledWith("ai/indexer", expect.objectContaining({ message: "db closed" }), { paperId: "p1" });
  });
});

describe("AiIndexer paper events", () => {
  it("indexes a paper announced as added and stops listening once detached", async () => {
    const { indexer, stored, flush, fire } = makeIndexer();
    const detach = indexer.attach();

    fire.upsert("p1");
    await flush();
    expect(stored.has("p1")).toBe(true);

    detach();
    fire.upsert("p2");
    await flush();
    expect(stored.has("p2")).toBe(false);
  });
});
