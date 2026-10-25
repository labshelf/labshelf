import type { ILogger } from "@labshelf/core";
import { IndexedDbFileSystem } from "../../src/storage/idbFileSystem";
import { rebuildRecords } from "../../src/storage/rebuildPaperRecords";
import { clearFakeDb, fakeRows, putFile } from "../support/fakeIdb";

jest.mock("webextension-polyfill", () => ({}));
jest.mock("../../src/storage/idbDatabase", () => ({ getDb: async () => require("../support/fakeIdb").fakeDb }));

const logger: ILogger = { log: async () => undefined, error: async () => undefined };

beforeEach(() => clearFakeDb());

it("replaces the metadata store with the papers the files hold", async () => {
  putFile("papers/a/metadata.yaml", "title: Paper A\n");
  putFile("papers/topic/b/metadata.yaml", "title: Paper B\n");
  fakeRows.metadata.set("stale", { paperId: "stale", record: { id: "stale" }, folderPath: "papers/stale" });

  await rebuildRecords(new IndexedDbFileSystem(), logger);

  expect([...fakeRows.metadata.keys()].sort()).toEqual(["a", "b"]);
  expect(fakeRows.metadata.get("b")).toMatchObject({ folderPath: "papers/topic/b", record: { title: "Paper B" } });
});

it("keeps the store when the scan fails", async () => {
  fakeRows.metadata.set("kept", { paperId: "kept", record: { id: "kept" }, folderPath: "papers/kept" });
  const failing = { listDir: async () => { throw new Error("bridge down"); }, stat: async () => undefined, readText: async () => "" };

  await expect(rebuildRecords(failing, logger)).rejects.toThrow("bridge down");
  expect([...fakeRows.metadata.keys()]).toEqual(["kept"]);
});
