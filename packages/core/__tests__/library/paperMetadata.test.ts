import { createPaperRecord, parsePaperMetadata } from "@labshelf/core";

const location = { id: "vaswani2017", path: "/lib/papers/ml/vaswani2017", hasPdf: true };

describe("parsePaperMetadata", () => {
  it("returns the mapping, or undefined for anything else", () => {
    expect(parsePaperMetadata("title: A\nyear: 2017\n")).toEqual({ title: "A", year: 2017 });
    expect(parsePaperMetadata("- a\n- b\n")).toBeUndefined();
    expect(parsePaperMetadata("title: [unclosed")).toBeUndefined();
    expect(parsePaperMetadata("")).toBeUndefined();
  });
});

describe("paperRecordFromMetadata", () => {
  it("maps every field and takes the id and PDF presence from the folder", () => {
    const record = createPaperRecord({
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani", 3, "Noam Shazeer"],
      year: 2017,
      citekey: "vaswani2017",
      status: "reading",
      journal: "NeurIPS",
      doi: "10.5555/3295222",
      keywords: ["transformers"],
      tags: ["nlp", ""],
      note: "great",
      textLayer: { state: "native", checkedAt: "2026-01-01" },
      hasPdf: false,
      path: "/somewhere/else",
    }, location);
    expect(record).toMatchObject({
      id: "vaswani2017",
      path: "/lib/papers/ml/vaswani2017",
      hasPdf: true,
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani", "Noam Shazeer"],
      year: 2017,
      status: "reading",
      journal: "NeurIPS",
      doi: "10.5555/3295222",
      keywords: ["transformers"],
      note: "great",
      textLayer: { state: "native" },
    });
    expect(record.tags).toEqual(["nlp", ""]);
  });

  it("falls back to the folder name for title and citekey and to unread for an unknown status", () => {
    const record = createPaperRecord({ status: "archived", year: "2017" }, { ...location, hasPdf: false });
    expect(record.title).toBe("vaswani2017");
    expect(record.citeKey).toBe("vaswani2017");
    expect(record.status).toBe("unread");
    expect(record.year).toBeUndefined();
    expect(record.hasPdf).toBe(false);
  });

  it("drops numbers in string fields instead of coercing them", () => {
    const record = createPaperRecord({ volume: 15, pages: 12, issue: "3" }, location);
    expect(record).not.toHaveProperty("volume");
    expect(record).not.toHaveProperty("pages");
    expect(record.issue).toBe("3");
  });

  it("keeps blank strings and blank list entries as written", () => {
    const record = createPaperRecord({ title: "", citekey: " ", journal: "", authors: ["", "Noam Shazeer"] }, location);
    expect(record.title).toBe("");
    expect(record.citeKey).toBe(" ");
    expect(record.journal).toBe("");
    expect(record.authors).toEqual(["", "Noam Shazeer"]);
  });
});

describe("paperRecordFromMetadata pdfVersion", () => {
  it.each(["preprint", "accepted", "published"])("reads %s", (pdfVersion) => {
    expect(createPaperRecord({ pdfVersion }, location).pdfVersion).toBe(pdfVersion);
  });

  it.each([["final"], [3], [null], [""]])("ignores the invalid value %p", (pdfVersion) => {
    expect(createPaperRecord({ pdfVersion }, location)).not.toHaveProperty("pdfVersion");
  });

  it("loads a sidecar that has no pdfVersion", () => {
    expect(createPaperRecord({ title: "A" }, location)).not.toHaveProperty("pdfVersion");
  });
});

describe("paperRecordFromMetadata pdfRequestedAt", () => {
  it("reads a YYYY-MM-DD day", () => {
    expect(createPaperRecord({ pdfRequestedAt: "2026-10-15" }, location).pdfRequestedAt).toBe("2026-10-15");
  });

  it.each([["15/10/2026"], ["2026-10-15T10:00:00Z"], ["2026-1-5"], [20261015], [null], [""], [new Date()]])("ignores the invalid value %p", (pdfRequestedAt) => {
    expect(createPaperRecord({ pdfRequestedAt }, location)).not.toHaveProperty("pdfRequestedAt");
  });

  it("loads a sidecar that has no pdfRequestedAt", () => {
    expect(createPaperRecord({ title: "A" }, location)).not.toHaveProperty("pdfRequestedAt");
  });
});

describe("paperRecordFromMetadata statusChangedAt", () => {
  it("reads an ISO timestamp string", () => {
    expect(createPaperRecord({ statusChangedAt: "2026-10-15T10:00:00.000Z" }, location).statusChangedAt).toBe("2026-10-15T10:00:00.000Z");
  });

  it.each([["yesterday"], ["15/10/2026"], [20261015], [null], [""], [new Date()]])("ignores the invalid value %p", (statusChangedAt) => {
    expect(createPaperRecord({ statusChangedAt }, location)).not.toHaveProperty("statusChangedAt");
  });

  it("loads a sidecar that has no statusChangedAt", () => {
    expect(createPaperRecord({ title: "A" }, location)).not.toHaveProperty("statusChangedAt");
  });
});

describe("paperRecordFromMetadata files", () => {
  it("reads the files map of descriptions", () => {
    expect(createPaperRecord({ files: { "notes.md": "My notes", data: "Raw" } }, location).files).toEqual({ "notes.md": "My notes", data: "Raw" });
  });

  it("drops entries whose description is not a string", () => {
    expect(createPaperRecord({ files: { "a.txt": "ok", "b.txt": 3, "c.txt": null, "d.txt": ["x"] } }, location).files).toEqual({ "a.txt": "ok" });
  });

  it.each([["text"], [3], [["a"]], [null], [{}]])("leaves files out for the value %p", (files) => {
    expect(createPaperRecord({ files }, location)).not.toHaveProperty("files");
  });

  it("leaves files out when the key is absent", () => {
    expect(createPaperRecord({ title: "A" }, location)).not.toHaveProperty("files");
  });
});
