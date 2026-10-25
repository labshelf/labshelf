/** Describing a paper's file through the library mutations writes metadata.yaml and the listing shows it. */
import type { ILogger, PaperRecord } from "@labshelf/core";
import { createLibraryMutations } from "../../src/storage/libraryMutations";
import { fakeFiles, putFile, textAt } from "../support/fakeIdb";

jest.mock("../../src/storage/idbDatabase", () => ({ openDb: async () => require("../support/fakeIdb").fakeDb }));

const mockCache = new Map<string, PaperRecord>();
jest.mock("../../src/storage/paperRecordStore", () => ({
  listCachedPaperRecords: async () => [...mockCache.values()],
  writeCachedPaperRecord: async (record: PaperRecord) => { mockCache.set(record.id, record); },
  removeCachedPaperRecord: async (id: string) => { mockCache.delete(id); },
}));

const logger: ILogger = { log: async () => undefined, error: async () => undefined };
const mutations = createLibraryMutations(logger);
const record: PaperRecord = { id: "a2020", title: "A", citeKey: "a2020", path: "papers/a2020", status: "unread" };

beforeEach(() => {
  fakeFiles.clear();
  mockCache.clear();
  mockCache.set(record.id, record);
  putFile("papers/a2020/metadata.yaml", "title: A\nstatus: unread\ncitekey: a2020\n");
  putFile("papers/a2020/data.csv", "a,b");
});

describe("describeFile and listFiles", () => {
  it("writes the description to metadata.yaml and the listing shows it", async () => {
    const updated = await mutations.describeFile({ id: record.id, path: record.path }, "data.csv", "raw data");

    expect(updated?.id).toBe("a2020");
    expect(textAt("papers/a2020/metadata.yaml")).toMatch(/raw data/);
    const state = await mutations.listFiles(record);
    expect(state.status).toBe("ready");
    const file = state.status === "ready" ? state.files.find((f) => f.name === "data.csv") : undefined;
    expect(file?.description).toBe("raw data");
  });

  it("removes the stored description when it is empty", async () => {
    await mutations.describeFile({ id: record.id, path: record.path }, "data.csv", "raw data");
    await mutations.describeFile({ id: record.id, path: record.path }, "data.csv", "");
    expect(textAt("papers/a2020/metadata.yaml")).not.toMatch(/raw data/);
  });
});
