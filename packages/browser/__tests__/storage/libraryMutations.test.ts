import type { ILogger, PaperRecord } from "@labshelf/core";
import { createLibraryMutations } from "../../src/storage/libraryMutations";
import { fakeFiles, putFile, textAt } from "../support/fakeIdb";

jest.mock("../../src/storage/idb/db", () => ({ getDb: async () => require("../support/fakeIdb").fakeDb }));

const mockCache = new Map<string, PaperRecord>();
jest.mock("../../src/storage/paperRecordStore", () => ({
  listAllRecords: async () => [...mockCache.values()],
  upsertRecord: async (record: PaperRecord) => { mockCache.set(record.id, record); },
  deleteRecord: async (id: string) => { mockCache.delete(id); },
}));

const logger: ILogger = { log: async () => undefined, error: async () => undefined };
const mutations = createLibraryMutations(logger);

function paper(id: string, folder = "papers", over: Partial<PaperRecord> = {}): PaperRecord {
  return { id, title: id, citeKey: id, path: `${folder}/${id}`, status: "unread", ...over };
}

function seed(record: PaperRecord, yaml: string): void {
  mockCache.set(record.id, record);
  putFile(`${record.path}/metadata.yaml`, yaml);
}

beforeEach(() => {
  fakeFiles.clear();
  mockCache.clear();
});

describe("importPaper", () => {
  const imported = { metadata: { authors: ["Ann Lee"], year: 2020, title: "Attention" }, log: { message: "Paper captured", context: {} } };

  it("writes the paper's files without a folder marker and caches its record", async () => {
    const record = await mutations.importPaper("papers", { ...imported, extra: { tags: ["NLP"] } });

    expect(record).toMatchObject({ id: "lee2020attention", path: "papers/lee2020attention", title: "Attention", tags: ["NLP"], hasPdf: false });
    expect([...fakeFiles.keys()].sort()).toEqual(["papers/lee2020attention/bib.bib", "papers/lee2020attention/metadata.yaml"]);
    expect(mockCache.get("lee2020attention")).toEqual(record);
  });

  it("skips an id taken in another casing", async () => {
    mockCache.set("Lee2020Attention", paper("Lee2020Attention"));
    const record = await mutations.importPaper("papers", imported);
    expect(record.id).toBe("lee2020attentiona");
    expect(record.path).toBe("papers/lee2020attentiona");
  });

  it("skips a folder that exists without a cached record", async () => {
    putFile("papers/lee2020attention/metadata.yaml", "");
    expect((await mutations.importPaper("papers", imported)).id).toBe("lee2020attentiona");
  });
});

describe("setStatus", () => {
  it("keeps keys of metadata.yaml that the browser does not own", async () => {
    const record = paper("a2020");
    seed(record, "title: A\nstatus: unread\ncitekey: a2020\nreviewer: ana\n");

    const outcome = await mutations.setStatus([{ id: record.id, path: record.path }], "done");

    expect(outcome.done).toEqual(["a2020"]);
    expect(textAt("papers/a2020/metadata.yaml")).toMatch(/reviewer: ana/);
    expect(textAt("papers/a2020/metadata.yaml")).toMatch(/status: done/);
    expect(mockCache.get("a2020")?.status).toBe("done");
  });

  it("changes only the status: a title edited on disk after the cache was built survives", async () => {
    const record = paper("a2020", "papers", { title: "Stale title" });
    seed(record, "title: Edited elsewhere\nstatus: unread\ncitekey: a2020\n");

    await mutations.setStatus([{ id: record.id, path: record.path }], "reading");

    expect(textAt("papers/a2020/metadata.yaml")).toMatch(/title: Edited elsewhere/);
    expect(mockCache.get("a2020")?.title).toBe("Edited elsewhere");
  });

  it("reports a paper whose folder is gone and leaves the cache alone", async () => {
    mockCache.set("gone", paper("gone"));
    const outcome = await mutations.setStatus([{ id: "gone", path: "papers/gone" }], "done");
    expect(outcome.failed).toEqual([{ id: "gone", error: "Paper not found" }]);
    expect(mockCache.get("gone")?.status).toBe("unread");
  });
});

describe("editTags", () => {
  it("adds and removes tags in metadata.yaml and in the cache", async () => {
    const record = paper("a2020", "papers", { tags: ["old", "keep"] });
    seed(record, "title: A\nstatus: unread\ncitekey: a2020\ntags: [old, keep]\nreviewer: ana\n");

    const outcome = await mutations.editTags([{ id: record.id, path: record.path }], ["new"], ["old"]);

    expect(outcome.done).toEqual(["a2020"]);
    expect(mockCache.get("a2020")?.tags).toEqual(["keep", "new"]);
    expect(textAt("papers/a2020/metadata.yaml")).toMatch(/reviewer: ana/);
    expect(textAt("papers/a2020/metadata.yaml")).toMatch(/new/);
    expect(textAt("papers/a2020/metadata.yaml")).not.toMatch(/old/);
  });

  it("reports a paper whose folder is gone", async () => {
    const outcome = await mutations.editTags([{ id: "gone", path: "papers/gone" }], ["x"], []);
    expect(outcome.failed).toEqual([{ id: "gone", error: "Paper not found" }]);
  });
});

describe("setNote", () => {
  it("writes the note to metadata.yaml and the cache", async () => {
    const record = paper("a2020");
    seed(record, "title: A\nstatus: unread\ncitekey: a2020\n");

    const written = await mutations.setNote({ id: record.id, path: record.path }, "Read chapter 3 again");

    expect(written?.note).toBe("Read chapter 3 again");
    expect(textAt("papers/a2020/metadata.yaml")).toMatch(/Read chapter 3 again/);
    expect(mockCache.get("a2020")?.note).toBe("Read chapter 3 again");
  });

  it("resolves to undefined for a paper whose folder is gone and leaves the cache alone", async () => {
    mockCache.set("gone", paper("gone"));
    expect(await mutations.setNote({ id: "gone", path: "papers/gone" }, "x")).toBeUndefined();
    expect(mockCache.get("gone")?.note).toBeUndefined();
  });
});

describe("setPdfRequestedAt", () => {
  it("writes the day to metadata.yaml and the cache", async () => {
    const record = paper("a2020");
    seed(record, "title: A\nstatus: unread\ncitekey: a2020\n");

    const written = await mutations.setPdfRequestedAt({ id: record.id, path: record.path }, "2026-10-15");

    expect(written?.pdfRequestedAt).toBe("2026-10-15");
    expect(textAt("papers/a2020/metadata.yaml")).toMatch(/2026-10-15/);
    expect(mockCache.get("a2020")?.pdfRequestedAt).toBe("2026-10-15");
  });

  it("resolves to undefined for a paper whose folder is gone and leaves the cache alone", async () => {
    mockCache.set("gone", paper("gone"));
    expect(await mutations.setPdfRequestedAt({ id: "gone", path: "papers/gone" }, "2026-10-15")).toBeUndefined();
    expect(mockCache.get("gone")?.pdfRequestedAt).toBeUndefined();
  });
});

describe("recordPdfAttached", () => {
  it("keeps the status on disk when the cached status is stale and marks the PDF present", async () => {
    const record = paper("a2020", "papers", { status: "unread" });
    seed(record, "title: A\nstatus: done\ncitekey: a2020\n");

    const written = await mutations.recordPdfAttached(record);

    expect(written.status).toBe("done");
    expect(written.hasPdf).toBe(true);
    expect(textAt("papers/a2020/metadata.yaml")).toMatch(/status: done/);
    expect(mockCache.get("a2020")).toMatchObject({ status: "done", hasPdf: true });
  });
});

describe("recordPdfAttached version", () => {
  it("writes the version to the yaml and the cache, keeping status, tags and note", async () => {
    const record = paper("a2020", "papers", { tags: ["nlp"], note: "keep me" });
    seed(record, "title: A\nstatus: reading\ncitekey: a2020\ntags: [nlp]\nnote: keep me\n");

    const written = await mutations.recordPdfAttached(record, "accepted");

    expect(written).toMatchObject({ pdfVersion: "accepted", status: "reading", tags: ["nlp"], note: "keep me", hasPdf: true });
    expect(textAt("papers/a2020/metadata.yaml")).toMatch(/pdfVersion: accepted/);
    expect(mockCache.get("a2020")?.pdfVersion).toBe("accepted");
  });

  it("removes an existing version when the new file's version is unknown", async () => {
    const record = paper("a2020", "papers", { pdfVersion: "preprint" });
    seed(record, "title: A\nstatus: unread\ncitekey: a2020\npdfVersion: preprint\n");

    const written = await mutations.recordPdfAttached(record);

    expect(written.pdfVersion ?? null).toBeNull();
    expect(textAt("papers/a2020/metadata.yaml")).not.toMatch(/pdfVersion/);
  });

  it("drops the text-layer check of the file it replaces", async () => {
    const record = paper("a2020", "papers", { textLayer: { state: "missing", checkedAt: "2024-01-01T00:00:00Z" } });
    seed(record, "title: A\nstatus: unread\ncitekey: a2020\ntextLayer:\n  state: missing\n  checkedAt: 2024-01-01T00:00:00Z\n");

    const written = await mutations.recordPdfAttached(record, "published");

    expect(written.textLayer).toBeUndefined();
    expect(textAt("papers/a2020/metadata.yaml")).not.toMatch(/textLayer/);
    expect(mockCache.get("a2020")?.textLayer).toBeUndefined();
  });
});

describe("movePapers", () => {
  it("moves the folder on disk and re-points the cached record", async () => {
    seed(paper("a2020"), "title: A\n");
    putFile("papers/Thesis/.keep", "");

    const outcome = await mutations.movePapers([{ id: "a2020", path: "papers/a2020" }], "papers/Thesis");

    expect(outcome.done).toEqual(["a2020"]);
    expect(textAt("papers/Thesis/a2020/metadata.yaml")).toBe("title: A\n");
    expect(fakeFiles.has("papers/a2020/metadata.yaml")).toBe(false);
    expect(mockCache.get("a2020")?.path).toBe("papers/Thesis/a2020");
  });

  it("fails a paper whose key is taken at the destination and moves nothing", async () => {
    seed(paper("a2020"), "title: A\n");
    putFile("papers/Thesis/a2020/metadata.yaml", "title: other\n");

    const outcome = await mutations.movePapers([{ id: "a2020", path: "papers/a2020" }], "papers/Thesis");

    expect(outcome.failed).toEqual([{ id: "a2020", error: '"a2020" already exists there' }]);
    expect(mockCache.get("a2020")?.path).toBe("papers/a2020");
  });
});

describe("trashPapers", () => {
  it("deletes the folder and drops only the trashed ids from the cache", async () => {
    seed(paper("a2020"), "title: A\n");
    putFile("papers/a2020/paper.pdf", "PDF");
    seed(paper("b2021"), "title: B\n");

    const outcome = await mutations.trashPapers([{ id: "a2020", path: "papers/a2020" }]);

    expect(outcome.done).toEqual(["a2020"]);
    expect([...fakeFiles.keys()]).toEqual(["papers/b2021/metadata.yaml"]);
    expect([...mockCache.keys()]).toEqual(["b2021"]);
  });
});

describe("folders", () => {
  it("creates a folder as a .keep marker and refuses an existing name", async () => {
    expect(await mutations.createFolder("papers", " Reading ")).toBe("papers/Reading");
    expect(fakeFiles.has("papers/Reading/.keep")).toBe(true);
    await expect(mutations.createFolder("papers", "Reading")).rejects.toThrow('"Reading" already exists');
  });

  it("renames a folder and re-points the records under it", async () => {
    seed(paper("a2020", "papers/ML"), "title: A\n");

    expect(await mutations.renameFolder("papers/ML", "AI")).toBe("papers/AI");

    expect(fakeFiles.has("papers/AI/a2020/metadata.yaml")).toBe(true);
    expect(mockCache.get("a2020")?.path).toBe("papers/AI/a2020");
  });

  it("refuses to rename onto a sibling", async () => {
    putFile("papers/ML/.keep", "");
    putFile("papers/AI/.keep", "");
    await expect(mutations.renameFolder("papers/ML", "AI")).rejects.toThrow('"AI" already exists there');
  });

  it("trashes a folder with its papers and removes their records", async () => {
    seed(paper("a2020", "papers/ML"), "title: A\n");
    seed(paper("b2021"), "title: B\n");

    await mutations.trashFolder("papers/ML");

    expect([...fakeFiles.keys()]).toEqual(["papers/b2021/metadata.yaml"]);
    expect([...mockCache.keys()]).toEqual(["b2021"]);
  });

  it("refuses to trash the library root", async () => {
    await expect(mutations.trashFolder("papers")).rejects.toThrow("The library root cannot be deleted");
  });
});
