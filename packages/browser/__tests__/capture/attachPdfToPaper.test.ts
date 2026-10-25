import type { ILogger, PaperRecord } from "@labshelf/core";

jest.mock("webextension-polyfill", () => ({ storage: { local: { get: async () => ({}), set: async () => undefined } } }));

// The real IndexedDbFileSystem runs over a Map-backed store, so attachPdfToPaper exercises its real write path.
jest.mock("../../src/storage/idbDatabase", () => ({ openDb: async () => require("../support/fakeIdb").fakeDb }));

let mockRecords: PaperRecord[] = [];
jest.mock("../../src/storage/paperRecordStore", () => ({
  listCachedPaperRecords: async () => mockRecords,
  writeCachedPaperRecord: async () => undefined,
}));

import { attachPdfToPaper } from "../../src/capture/attachPdfToPaper";
import { normalizeFolder } from "../../src/capture/captureService";
import { createLibraryMutations } from "../../src/storage/libraryMutations";
import { fakeFiles, putFile, textAt } from "../support/fakeIdb";

const log: ILogger = { log: async () => undefined, error: async () => undefined };
const mutations = createLibraryMutations(log);

describe("normalizeFolder", () => {
  it("accepts collections under papers/ and falls back to the root otherwise", () => {
    expect(normalizeFolder("papers/Thesis/Ch2/")).toBe("papers/Thesis/Ch2");
    expect(normalizeFolder(undefined)).toBe("papers");
    expect(normalizeFolder(".research/secrets")).toBe("papers");
    expect(normalizeFolder("papers/../.research")).toBe("papers");
    expect(normalizeFolder("papers\\..\\.research")).toBe("papers");
    expect(normalizeFolder("papers/a\\b")).toBe("papers");
  });
});

describe("attachPdfToPaper", () => {
  const PDF = new TextEncoder().encode("%PDF-1.7\n...");
  const record = (over: Partial<PaperRecord> = {}): PaperRecord =>
    ({ id: "smith2020deep", title: "Deep", citeKey: "smith2020deep", path: "papers/smith2020deep", status: "unread", ...over });

  beforeEach(() => { fakeFiles.clear(); mockRecords = []; });

  it("writes paper.pdf and rewrites the artifacts when the paper had none", async () => {
    mockRecords = [record()];
    putFile("papers/smith2020deep/metadata.yaml", "title: Deep\nstatus: unread\n");
    const result = await attachPdfToPaper(mutations, "smith2020deep", PDF);
    expect(result.written).toBe(true);
    expect(result.record.id).toBe("smith2020deep");
    expect(fakeFiles.get("papers/smith2020deep/paper.pdf")?.bytes).toBe(PDF);
    expect(fakeFiles.has("papers/smith2020deep/metadata.yaml")).toBe(true);
    expect(fakeFiles.has("papers/smith2020deep/bib.bib")).toBe(true);
  });

  it("refuses to overwrite a PDF that is already there and rewrites nothing", async () => {
    mockRecords = [record()];
    const existing = new Uint8Array([1, 2, 3]);
    putFile("papers/smith2020deep/paper.pdf", existing);
    const result = await attachPdfToPaper(mutations, "smith2020deep", PDF);
    expect(result.written).toBe(false);
    expect(fakeFiles.get("papers/smith2020deep/paper.pdf")?.bytes).toBe(existing);
    expect(fakeFiles.has("papers/smith2020deep/metadata.yaml")).toBe(false);
  });

  it("overwrites an existing PDF with replace and records the version", async () => {
    mockRecords = [record({ pdfVersion: "preprint" })];
    putFile("papers/smith2020deep/metadata.yaml", "title: Deep\nstatus: unread\npdfVersion: preprint\n");
    putFile("papers/smith2020deep/paper.pdf", new Uint8Array([1, 2, 3]));
    const result = await attachPdfToPaper(mutations, "smith2020deep", PDF, { replace: true, version: "published" });
    expect(result.written).toBe(true);
    expect(result.record.pdfVersion).toBe("published");
    expect(fakeFiles.get("papers/smith2020deep/paper.pdf")?.bytes).toBe(PDF);
    expect(textAt("papers/smith2020deep/metadata.yaml")).toMatch(/pdfVersion: published/);
  });

  it("refuses an existing PDF when only a version is given", async () => {
    mockRecords = [record()];
    const existing = new Uint8Array([1, 2, 3]);
    putFile("papers/smith2020deep/paper.pdf", existing);
    const result = await attachPdfToPaper(mutations, "smith2020deep", PDF, { version: "published" });
    expect(result.written).toBe(false);
    expect(fakeFiles.get("papers/smith2020deep/paper.pdf")?.bytes).toBe(existing);
  });

  it("writes at the record's current path even when it moved since the id was captured", async () => {
    mockRecords = [record({ path: "papers/Thesis/smith2020deep" })];
    putFile("papers/Thesis/smith2020deep/metadata.yaml", "title: Deep\nstatus: unread\n");
    const result = await attachPdfToPaper(mutations, "smith2020deep", PDF);
    expect(result.written).toBe(true);
    expect(fakeFiles.has("papers/Thesis/smith2020deep/paper.pdf")).toBe(true);
    expect(fakeFiles.has("papers/smith2020deep/paper.pdf")).toBe(false);
  });

  it("keeps the status on disk when the cached status is stale", async () => {
    mockRecords = [record({ status: "unread" })];
    putFile("papers/smith2020deep/metadata.yaml", "title: Deep\nstatus: done\ncitekey: smith2020deep\n");
    await attachPdfToPaper(mutations, "smith2020deep", PDF);
    expect(textAt("papers/smith2020deep/metadata.yaml")).toMatch(/status: done/);
  });

  it("throws when the record is gone", async () => {
    mockRecords = [];
    await expect(attachPdfToPaper(mutations, "ghost", PDF)).rejects.toThrow(/no longer in the library/);
  });
});
