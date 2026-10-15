import * as vscode from "vscode";
import { createAiService } from "../../../src/ai/service/aiServiceFactory";
import type { AiServiceFactoryDependencies } from "../../../src/ai/service/aiServiceFactory";
import { HashEmbeddingProvider } from "../../../src/ai/runtime";
import { AiIndexer } from "../../../src/ai/indexer/aiIndexer";

jest.mock("../../../src/ai/pdf/pdfTextExtractor", () => ({ PdfTextExtractor: jest.fn() }));
jest.mock("../../../src/ai/indexer/aiIndexer", () => ({
  AiIndexer: jest.fn(() => ({ attach: () => () => {} })),
}));

const STORES = { vectorStore: { tag: 'vectors' }, hashes: { tag: 'hashes' } };

function makeDeps() {
  return {
    context: {},
    storage: { createStores: jest.fn(() => STORES) },
    listPapers: async () => [],
    fileSystem: {},
    eventBus: { emit: jest.fn(), on: jest.fn(), off: jest.fn() },
    logger: { error: jest.fn(async () => {}), log: jest.fn(async () => {}) },
    pdfOpener: {},
    resolvePdfUri: async () => null,
  } as unknown as AiServiceFactoryDependencies;
}

describe("createAiService", () => {
  it("embeds with the hash provider, keys vector rows by its model id and hands the stores to the indexer", async () => {
    const deps = makeDeps();

    const result = await createAiService(deps);

    expect(result?.service).toBeDefined();
    const hashModelId = new HashEmbeddingProvider().modelId;
    expect(deps.storage.createStores).toHaveBeenCalledWith(hashModelId);
    expect(AiIndexer).toHaveBeenCalledWith(expect.objectContaining({ vectorStore: STORES.vectorStore, hashes: STORES.hashes }));
    expect(deps.eventBus.emit).not.toHaveBeenCalled();
    expect(deps.logger.error).not.toHaveBeenCalled();
  });

  it("returns null when AI is disabled in settings", async () => {
    const get = jest.fn(() => false);
    jest.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({ get } as never);

    expect(await createAiService(makeDeps())).toBeNull();
  });
});
