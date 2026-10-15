import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describeIfSqlite, placeholderEnvTest, sqliteAvailable } from "../sqliteAvailable";

placeholderEnvTest("dropForeignKeyEmbeddings");

describeIfSqlite("dropForeignKeyEmbeddings through openAiStorage", () => {
  if (!sqliteAvailable()) return;
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const { openAiStorage } = require("../../../../src/ai/node/openAiStorage");

  let dir: string;
  let databasePath: string;
  const ensureDir = async (target: string) => { fs.mkdirSync(target, { recursive: true }); };
  const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-ai-migration-"));
    databasePath = path.join(dir, "index.sqlite");
    logger.log.mockClear();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const chunk = (paperId: string) => ({
    record: { id: 0, paperId, kind: "section" as const, text: "t" },
    embedding: new Float32Array([1, 0]),
  });

  it("drops embeddings that reference the old papers table so any paper can be indexed", async () => {
    const old = new DatabaseSync(databasePath);
    old.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE papers (id TEXT PRIMARY KEY);
      CREATE TABLE chunk_embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, section TEXT, page INTEGER, start_offset INTEGER, end_offset INTEGER, text TEXT,
        embedding BLOB NOT NULL, dim INTEGER NOT NULL, model_id TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE indexed_papers (paper_id TEXT PRIMARY KEY, content_hash TEXT NOT NULL);
      INSERT INTO papers (id) VALUES ('known');
      INSERT INTO indexed_papers (paper_id, content_hash) VALUES ('known', 'h');
    `);
    old.close();

    const storage = await openAiStorage(databasePath, { ensureDir }, logger);
    const { vectorStore, hashes } = storage.createStores("model-a");

    await expect(vectorStore.upsert([chunk("unknown")])).resolves.toBeUndefined();
    expect(hashes.get("known")).toBeNull();
    const infoCalls = logger.log.mock.calls.filter((call: unknown[]) => call[0] === "INFO");
    expect(infoCalls).toHaveLength(1);

    const check = new DatabaseSync(databasePath);
    expect(check.prepare("SELECT id FROM papers").all()).toEqual([{ id: "known" }]);
    check.close();
  });

  it("opens a database written before the indexed_papers table existed", async () => {
    const old = new DatabaseSync(databasePath);
    old.exec(`
      CREATE TABLE papers (id TEXT PRIMARY KEY);
      CREATE TABLE chunk_embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, section TEXT, page INTEGER, start_offset INTEGER, end_offset INTEGER, text TEXT,
        embedding BLOB NOT NULL, dim INTEGER NOT NULL, model_id TEXT NOT NULL, created_at INTEGER NOT NULL
      );
    `);
    old.close();

    const storage = await openAiStorage(databasePath, { ensureDir }, logger);
    const { vectorStore } = storage.createStores("model-a");

    await expect(vectorStore.upsert([chunk("unknown")])).resolves.toBeUndefined();
  });

  it("leaves a current-schema database untouched", async () => {
    const first = await openAiStorage(databasePath, { ensureDir }, logger);
    const firstStores = first.createStores("model-a");
    await firstStores.vectorStore.upsert([chunk("p1")]);
    firstStores.hashes.set("p1", "h");

    const second = await openAiStorage(databasePath, { ensureDir }, logger);
    const secondStores = second.createStores("model-a");

    expect(secondStores.hashes.get("p1")).toBe("h");
    expect(await secondStores.vectorStore.search(new Float32Array([1, 0]), 1)).toHaveLength(1);
    expect(logger.log).not.toHaveBeenCalled();
  });
});
