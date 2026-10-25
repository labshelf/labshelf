// Pins durable merge bases and bounded text-version storage.
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as Y from "yjs";
import { readShareIndexDocFiles, addWrittenVersion, readWrittenHashes } from "../../../src/collab/model/index";
import { createNodeCollabStorage } from "../../../src/collab/node/index";
import { openCollabStore } from "../../../src/collab/deviceState/index";
import { fakeLogger } from "../doc/testSession";
import { memoryStorage } from "./memoryStorage";

it("restores versions and merge bases after closing and reopening node storage", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "labshelf-versions-"));
  const open = () => openCollabStore({ storage: createNodeCollabStorage({ dir, shareId: "1".repeat(64) }), logger: fakeLogger() });
  try {
    const first = await open();
    first.rememberVersion("main.typ", "first", "base text");
    first.rememberVersion("main.typ", "second", "current text");
    first.bases.set("main.typ", "current text");
    await first.close();
    const second = await open();
    expect(second.storedVersions("main.typ")).toEqual([
      { hash: "first", text: "base text" }, { hash: "second", text: "current text" },
    ]);
    expect(second.bases.get("main.typ")).toBe("current text");
    expect(second.storedVersions("missing.typ")).toEqual([]);
    await second.close();
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

it("retains the latest 50 versions and coalesces repeated agreement", async () => {
  const storage = memoryStorage();
  const store = await openCollabStore({ storage, logger: fakeLogger() });
  for (let i = 0; i < 55; i++) { store.rememberVersion("main.typ", String(i), `text ${i}`); }
  store.rememberVersion("main.typ", "54", "text 54");
  expect(store.storedVersions("main.typ")).toHaveLength(50);
  expect(store.storedVersions("main.typ")[0]).toEqual({ hash: "5", text: "text 5" });
  expect(store.storedVersions("main.typ")[49]).toEqual({ hash: "54", text: "text 54" });
  await store.close();
});

it("repairs competing written arrays immediately after restoring the index", async () => {
  const storage = memoryStorage();
  const first = await openCollabStore({ storage, logger: fakeLogger() });
  readShareIndexDocFiles(first.index).set("main.typ", { kind: "text" });
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(first.index));
  addWrittenVersion(first.index, "main.typ", "mine", 1);
  addWrittenVersion(peer, "main.typ", "theirs", 2);
  await first.close();
  const reopened = await openCollabStore({ storage, logger: fakeLogger() });
  for (let round = 0; round < 3; round++) {
    Y.applyUpdate(reopened.index, Y.encodeStateAsUpdate(peer));
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(reopened.index));
  }
  expect(readWrittenHashes(reopened.index, "main.typ")).toEqual(new Set(["mine", "theirs"]));
  expect(readWrittenHashes(peer, "main.typ")).toEqual(new Set(["mine", "theirs"]));
  await reopened.close();
});
