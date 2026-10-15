// The indexer reads each PDF once, skips unchanged content, survives failing jobs and clears deleted papers.
import * as vscode from "vscode";
import { sha256Hex } from "@labshelf/core";
import { AiIndexer } from "../../../src/ai/indexer/aiIndexer";
import type { AiIndexerDependencies } from "../../../src/ai/indexer/aiIndexer";

jest.mock("@labshelf/core", () => ({
  ...jest.requireActual("@labshelf/core"),
  runIngestion: jest.fn(async () => ({ chunkCount: 1, embeddedChunks: 1 })),
}));

const BYTES = new Uint8Array([1, 2, 3]);

function makeIndexer(options: {
  resolvePdfUri?: AiIndexerDependencies["resolvePdfUri"];
  papers?: Array<{ id: string }>;
  stored?: Record<string, string>;
} = {}) {
  const stored = new Map(Object.entries(options.stored ?? {}));
  const deps = {
    listPapers: jest.fn(async () => options.papers ?? [{ id: "p1" }]),
    eventBus: { emit: jest.fn(), on: jest.fn(), off: jest.fn() },
    logger: { error: jest.fn(async () => {}), log: jest.fn(async () => {}) },
    embedder: {},
    vectorStore: { deleteByPaper: jest.fn(async () => {}) },
    hashes: {
      get: jest.fn((id: string) => stored.get(id) ?? null),
      set: jest.fn((id: string, hash: string) => { stored.set(id, hash); }),
      delete: jest.fn((id: string) => { stored.delete(id); }),
    },
    extractor: { extract: jest.fn(async () => ({})) },
    resolvePdfUri: options.resolvePdfUri ?? (async (id: string) => vscode.Uri.file(`/lib/papers/${id}/paper.pdf`)),
    fileSystem: { readFile: jest.fn(async () => BYTES) },
  };
  const indexer = new AiIndexer(deps as unknown as AiIndexerDependencies);
  // rebuildAll resolves once every job it queued has finished, so an empty rebuild also flushes earlier jobs.
  const flush = async () => { deps.listPapers.mockResolvedValueOnce([]); await indexer.rebuildAll(); };
  return { indexer, deps, stored, flush };
}

describe("AiIndexer indexing", () => {
  it("reads the PDF once from wherever the resolver says it lives and stores its SHA-256", async () => {
    const nested = vscode.Uri.file("/lib/papers/Project/Refs/p1/paper.pdf");
    const { indexer, deps, stored } = makeIndexer({ resolvePdfUri: async () => nested });

    await indexer.rebuildAll();

    expect(deps.fileSystem.readFile).toHaveBeenCalledTimes(1);
    expect(deps.fileSystem.readFile).toHaveBeenCalledWith(nested.fsPath);
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
    const { indexer, deps } = makeIndexer({ resolvePdfUri: async () => null });

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
      resolvePdfUri: async (id) => { if (id === "bad") throw new Error("index locked"); return vscode.Uri.file("/p.pdf"); },
    });

    await indexer.rebuildAll();

    expect(deps.logger.error).toHaveBeenCalledWith("ai/indexer", expect.objectContaining({ message: "index locked" }), { paperId: "bad" });
    expect(stored.has("good")).toBe(true);
  });
});

describe("AiIndexer paper deletion", () => {
  function deletedHandler(deps: ReturnType<typeof makeIndexer>["deps"]) {
    return (deps.eventBus.on.mock.calls as Array<[string, (payload: unknown) => void]>).find(([event]) => event.includes("deleted"))![1];
  }

  it("removes the paper's vectors and hash row", async () => {
    const { indexer, deps, stored, flush } = makeIndexer({ stored: { p1: "h" } });
    indexer.attach();

    deletedHandler(deps)({ paperId: "p1" });
    await flush();

    expect(deps.vectorStore.deleteByPaper).toHaveBeenCalledWith("p1");
    expect(stored.has("p1")).toBe(false);
  });

  it("logs a failing vector delete", async () => {
    const { indexer, deps, flush } = makeIndexer();
    deps.vectorStore.deleteByPaper.mockRejectedValueOnce(new Error("db closed"));
    indexer.attach();

    deletedHandler(deps)({ paperId: "p1" });
    await flush();

    expect(deps.logger.error).toHaveBeenCalledWith("ai/indexer", expect.objectContaining({ message: "db closed" }), { paperId: "p1" });
  });
});
