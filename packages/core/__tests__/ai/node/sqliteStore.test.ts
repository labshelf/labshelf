// The SQLite store: schema, hash cache, vector index and the opener that builds them.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describeIfSqlite, placeholderEnvTest, sqliteAvailable } from "./sqliteAvailable";
import { decodeEmbedding, encodeEmbedding } from "../../../src/ai/node/sqliteStore";

placeholderEnvTest("ensureAiSchema");

describeIfSqlite("ensureAiSchema", () => {
  if (!sqliteAvailable()) return;
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const { ensureAiSchema } = require("../../../src/ai/node/sqliteStore");

  const INSERT_CHUNK = `INSERT INTO chunk_embeddings (paper_id, kind, text, embedding, dim, model_id, created_at)
    VALUES ('p1', 'section', ?, x'00', 1, 'm', 0)`;

  function makeDb() {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE papers (id TEXT PRIMARY KEY);`);
    db.prepare(`INSERT INTO papers (id) VALUES ('p1')`).run();
    return db;
  }

  it("accepts chunks without text on a fresh database", () => {
    const db = makeDb();
    ensureAiSchema(db);
    expect(() => db.prepare(INSERT_CHUNK).run(null)).not.toThrow();
  });

  it("is idempotent", () => {
    const db = makeDb();
    ensureAiSchema(db);
    expect(() => ensureAiSchema(db)).not.toThrow();
  });

  it("keeps one content hash per paper", () => {
    const db = makeDb();
    ensureAiSchema(db);
    const insert = db.prepare("INSERT INTO indexed_papers (paper_id, content_hash) VALUES ('p1', ?)");
    insert.run("a");
    expect(() => insert.run("b")).toThrow();
  });
});

placeholderEnvTest("SqliteHashCache");

describeIfSqlite("SqliteHashCache", () => {
  if (!sqliteAvailable()) return;
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const { ensureAiSchema } = require("../../../src/ai/node/sqliteStore");
  const { SqliteHashCache } = require("../../../src/ai/node/sqliteStore");

  function makeStore() {
    const db = new DatabaseSync(":memory:");
    ensureAiSchema(db);
    return new SqliteHashCache(db);
  }

  it("returns null for a paper that was never indexed", () => {
    expect(makeStore().get("p1")).toBeNull();
  });

  it("returns the latest hash set for a paper", () => {
    const store = makeStore();
    store.set("p1", "a");
    store.set("p1", "b");
    expect(store.get("p1")).toBe("b");
  });

  it("forgets a deleted paper and leaves the others", () => {
    const store = makeStore();
    store.set("p1", "a");
    store.set("p2", "b");
    store.delete("p1");
    expect(store.get("p1")).toBeNull();
    expect(store.get("p2")).toBe("b");
  });
});

placeholderEnvTest("SqliteVectorIndex");

describeIfSqlite("SqliteVectorIndex", () => {
  if (!sqliteAvailable()) return;
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const { SqliteVectorIndex } = require("../../../src/ai/node/sqliteStore");
  const { ensureAiSchema } = require("../../../src/ai/node/sqliteStore");

  function makeDb() {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE papers (id TEXT PRIMARY KEY, title TEXT, path TEXT, citekey TEXT, status TEXT);`);
    db.prepare(`INSERT INTO papers (id, title, path, citekey, status) VALUES (?, 'p', '/p', 'k', 'unread')`).run("p1");
    db.prepare(`INSERT INTO papers (id, title, path, citekey, status) VALUES (?, 'p', '/p', 'k', 'unread')`).run("p2");
    ensureAiSchema(db);
    return db;
  }

  it("upserts and retrieves by cosine top-k", async () => {
    const store = new SqliteVectorIndex(makeDb(), "test-model");
    await store.upsert([
      { record: { id: 0, paperId: "p1", kind: "section", text: "alpha" }, embedding: new Float32Array([1, 0, 0]) },
      { record: { id: 0, paperId: "p2", kind: "section", text: "beta" }, embedding: new Float32Array([0, 1, 0]) },
    ]);
    const results = await store.search(new Float32Array([1, 0, 0]), 2);
    expect(results[0].paperId).toBe("p1");
    expect(results[0].score).toBeCloseTo(1, 5);
  });

  it("respects paperId filter", async () => {
    const store = new SqliteVectorIndex(makeDb(), "test-model");
    await store.upsert([
      { record: { id: 0, paperId: "p1", kind: "section" }, embedding: new Float32Array([1, 0, 0]) },
      { record: { id: 0, paperId: "p2", kind: "section" }, embedding: new Float32Array([1, 0, 0]) },
    ]);
    const results = await store.search(new Float32Array([1, 0, 0]), 5, { paperIds: ["p2"] });
    expect(results.every((r: { paperId: string }) => r.paperId === "p2")).toBe(true);
  });

  it("deleteByPaper removes vectors", async () => {
    const store = new SqliteVectorIndex(makeDb(), "test-model");
    await store.upsert([
      { record: { id: 0, paperId: "p1", kind: "section" }, embedding: new Float32Array([1, 0, 0]) },
    ]);
    await store.deleteByPaper("p1");
    const results = await store.search(new Float32Array([1, 0, 0]), 5);
    expect(results).toEqual([]);
  });
});

describe("embeddingCodec", () => {
  it("round-trips a Float32Array", () => {
    const original = new Float32Array([0.1, -0.5, 1e-3, 2.5]);
    const buf = encodeEmbedding(original);
    const decoded = decodeEmbedding(buf, original.length);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it("throws on dimension mismatch", () => {
    const buf = encodeEmbedding(new Float32Array([1, 2, 3]));
    expect(() => decodeEmbedding(buf, 4)).toThrow();
  });
});

placeholderEnvTest("openAiStorage");

describeIfSqlite("openAiStorage", () => {
  if (!sqliteAvailable()) return;
  const { openAiStorage } = require("../../../src/ai/node/sqliteStore");

  it("creates the database folder and builds stores over one connection", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-ai-"));
    try {
      const ensureDir = jest.fn(async (target: string) => { fs.mkdirSync(target, { recursive: true }); });
      const storage = await openAiStorage(path.join(dir, "ai", "ai.sqlite"), { ensureDir }, { log: jest.fn(), error: jest.fn() });
      const { hashes, vectorStore } = storage.createStores("model-a");

      hashes.set("p1", "hash");

      expect(ensureDir).toHaveBeenCalledWith(path.join(dir, "ai"));
      expect(hashes.get("p1")).toBe("hash");
      expect(await vectorStore.search(new Float32Array([1, 0]), 1)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

placeholderEnvTest("dropForeignKeyEmbeddings");

describeIfSqlite("dropForeignKeyEmbeddings through openAiStorage", () => {
  if (!sqliteAvailable()) return;
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const { openAiStorage } = require("../../../src/ai/node/sqliteStore");

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

placeholderEnvTest("dropForeignKeyEmbeddings");

describeIfSqlite("dropForeignKeyEmbeddings through openAiStorage", () => {
  if (!sqliteAvailable()) return;
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const { openAiStorage } = require("../../../src/ai/node/sqliteStore");

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
