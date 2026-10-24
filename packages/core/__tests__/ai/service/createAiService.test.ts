// The factory embeds with the hash provider, keys vector rows by its model id and hands the stores and subscription to the indexer.
import { createAiService } from "../../../src/ai/service/createAiService";
import type { AiServiceFactoryDependencies } from "../../../src/ai/service/createAiService";
import { HashEmbeddingProvider } from "../../../src/ai/embedding/index";
import { AiIndexer } from "../../../src/ai/aiIndexer";

jest.mock("../../../src/ai/aiIndexer", () => ({
  AiIndexer: jest.fn(() => ({ attach: () => () => {} })),
}));

const STORES = { vectorStore: { tag: "vectors" }, hashes: { tag: "hashes" } };

function makeDeps() {
  return {
    storage: { createStores: jest.fn(() => STORES) },
    listPapers: async () => [],
    fileSystem: {},
    subscribe: jest.fn(() => () => {}),
    logger: { error: jest.fn(async () => {}), log: jest.fn(async () => {}) },
    pdfOpener: {},
    resolvePdfPath: async () => null,
  } as unknown as AiServiceFactoryDependencies;
}

describe("createAiService", () => {
  it("embeds with the hash provider, keys vector rows by its model id and hands the stores to the indexer", () => {
    const deps = makeDeps();

    const result = createAiService(deps);

    expect(result.service).toBeDefined();
    expect(deps.storage.createStores).toHaveBeenCalledWith(new HashEmbeddingProvider().modelId);
    expect(AiIndexer).toHaveBeenCalledWith(expect.objectContaining({
      vectorStore: STORES.vectorStore,
      hashes: STORES.hashes,
      subscribe: deps.subscribe,
      resolvePdfPath: deps.resolvePdfPath,
    }));
    expect(deps.logger.error).not.toHaveBeenCalled();
  });
});
