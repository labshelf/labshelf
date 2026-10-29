// Pins the library-format contract rules on paper identity and metadata.yaml with the contract's own examples.
// CONTRACT: documents/contracts/library-format.md#paper-identity
import { createCiteKey, createPaperRecord, ensureCiteKey, parsePaperMetadata } from "@labshelf/core";

const folder = { id: "vaswani2017attention", path: "/lib/papers/vaswani2017attention", hasPdf: false };

describe("paper identity", () => {
  it("takes the paper id from the folder name, whatever metadata.yaml says", () => {
    const record = createPaperRecord({ id: "other", citekey: "other2020key" }, folder);
    expect(record.id).toBe("vaswani2017attention");
  });

  it("builds a new id as authorYearWord (vaswani2017attention)", () => {
    const key = createCiteKey({ authors: ["Ashish Vaswani"], year: 2017, title: "Attention Is All You Need" }, "");
    expect(key).toBe("vaswani2017attention");
  });

  it("never gives a new id that collides case-insensitively with a paper", async () => {
    const key = await ensureCiteKey("Vaswani2017Attention", ["vaswani2017attention"], async () => false);
    expect(key.toLowerCase()).not.toBe("vaswani2017attention");
    expect(key).toBe("Vaswani2017Attentiona");
  });

  it("never gives a new id that collides with an existing folder", async () => {
    const onDisk = new Set(["vaswani2017attention"]);
    expect(await ensureCiteKey("vaswani2017attention", [], async (candidate) => onDisk.has(candidate))).toBe("vaswani2017attentiona");
  });
});

describe("metadata.yaml", () => {
  it("derives hasPdf from the folder listing and never reads it from the file", () => {
    const meta = parsePaperMetadata("title: A\nhasPdf: true\n")!;
    expect(createPaperRecord(meta, folder).hasPdf).toBe(false);
    expect(createPaperRecord(meta, { ...folder, hasPdf: true }).hasPdf).toBe(true);
  });

  it("reads status and tags as the user's own keys", () => {
    const meta = parsePaperMetadata("status: done\ntags: [ml, nlp]\n")!;
    expect(createPaperRecord(meta, folder)).toMatchObject({ status: "done", tags: ["ml", "nlp"] });
  });

  it("takes pdfRequestedAt only as a day", () => {
    expect(createPaperRecord({ pdfRequestedAt: "2026-10-15" }, folder).pdfRequestedAt).toBe("2026-10-15");
    expect(createPaperRecord({ pdfRequestedAt: "2026-10-15T10:00:00Z" }, folder)).not.toHaveProperty("pdfRequestedAt");
  });
});
