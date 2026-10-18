// Pins that both library sources answer a missing path the way the LocalFileSystem port promises.
import type { LibraryFileSystem } from "@labshelf/core";
import { BridgeFileSystem, BridgeLink } from "../../src/storage/bridge";
import { IndexedDbFileSystem } from "../../src/storage/indexedDbFileSystem";
import { fakeFiles } from "../support/fakeIdb";
import { FakeBridgeHost, silentLogger } from "./bridge/fakeBridgeHost";

jest.mock("../../src/storage/idb/db", () => ({ getDb: async () => require("../support/fakeIdb").fakeDb }));

beforeEach(() => fakeFiles.clear());

function bridgeFs(): LibraryFileSystem {
  const link = new BridgeLink(() => new FakeBridgeHost(), silentLogger);
  return new BridgeFileSystem(async () => (await link.open()).connection);
}

describe.each([
  ["IndexedDB", () => new IndexedDbFileSystem()],
  ["bridge", bridgeFs],
])("a missing path in %s", (_name, make: () => LibraryFileSystem) => {
  it("stats as undefined, does not exist and lists as empty", async () => {
    const fs = make();
    await expect(fs.stat("papers/gone/paper.pdf")).resolves.toBeUndefined();
    await expect(fs.exists("papers/gone")).resolves.toBe(false);
    await expect(fs.listDir("papers/gone")).resolves.toEqual([]);
  });

  it("rejects a read and deletes as a no-op", async () => {
    const fs = make();
    await expect(fs.readFile("papers/gone/paper.pdf")).rejects.toThrow("papers/gone/paper.pdf");
    await expect(fs.deleteFile("papers/gone/paper.pdf")).resolves.toBeUndefined();
    await expect(fs.trash("papers/gone")).resolves.toBeUndefined();
  });
});
