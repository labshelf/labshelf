import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describeIfSqlite, placeholderEnvTest, sqliteAvailable } from "./sqliteAvailable";

placeholderEnvTest("openAiStorage");

describeIfSqlite("openAiStorage", () => {
  if (!sqliteAvailable()) return;
  const { openAiStorage } = require("../../../src/ai/node/openAiStorage");

  it("creates the database folder and builds stores over one connection", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-ai-"));
    try {
      const ensureDir = jest.fn(async (target: string) => { fs.mkdirSync(target, { recursive: true }); });
      const storage = await openAiStorage(path.join(dir, "ai", "ai.sqlite"), { ensureDir });
      const { metadataStore, readingEvents, vectorStore } = storage.createStores("model-a");

      metadataStore.upsert({ paperId: "p1", methods: [], datasets: [], codeRepos: [], reproducibility: { score: 0, signals: [] }, limitations: [], difficultyProfile: {}, indexedAt: 1 }, "hash");
      readingEvents.append({ paperId: "p1", kind: "open", occurredAt: 2 });

      expect(ensureDir).toHaveBeenCalledWith(path.join(dir, "ai"));
      expect(metadataStore.listIndexed().get("p1")).toBe("hash");
      expect(await vectorStore.search(new Float32Array([1, 0]), 1)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
