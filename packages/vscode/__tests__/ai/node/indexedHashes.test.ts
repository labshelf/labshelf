// The SQLite hash store returns what was set, replaces on a second set and forgets deleted papers.
import { describeIfSqlite, placeholderEnvTest, sqliteAvailable } from "./sqliteAvailable";

placeholderEnvTest("SqliteIndexedHashes");

describeIfSqlite("SqliteIndexedHashes", () => {
  if (!sqliteAvailable()) return;
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const { ensureAiSchema } = require("../../../src/ai/node/aiSchema");
  const { SqliteIndexedHashes } = require("../../../src/ai/node/indexedHashes");

  function makeStore() {
    const db = new DatabaseSync(":memory:");
    ensureAiSchema(db);
    return new SqliteIndexedHashes(db);
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
