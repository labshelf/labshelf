import {
  describePaperFileOnFileSystem, movePapers, readPaperOnFileSystem, setPapersTrashed, updatePaperFields, updatePaperTags, writePaperRecord,
} from "@labshelf/core";

import { makeHarness, PAPERS } from "../../support/mutationHarness";

const P1 = `${PAPERS}/ML/p1`;

describe("describePaperFileOnDisk", () => {
  it("writes the description under the files key and keeps every other field", async () => {
    const h = makeHarness();
    await h.seedPaper(P1, { title: "T", status: "reading", tags: ["NLP"], note: "n", customKey: "keep" });
    await h.fs.writeText(`${P1}/slides.pdf`, "x");
    const record = await describePaperFileOnFileSystem(h.ctx, P1, "slides.pdf", "  Talk slides ");
    expect(await h.readMeta(P1)).toMatchObject({
      title: "T", status: "reading", tags: ["NLP"], note: "n", customKey: "keep", files: { "slides.pdf": "Talk slides" },
    });
    expect(record?.files).toEqual({ "slides.pdf": "Talk slides" });
  });

  it("removes the files key when the last description is cleared", async () => {
    const h = makeHarness();
    await h.seedPaper(P1, { title: "T", files: { "slides.pdf": "Talk slides" } });
    await h.fs.writeText(`${P1}/slides.pdf`, "x");
    await describePaperFileOnFileSystem(h.ctx, P1, "slides.pdf", "");
    expect(await h.readMeta(P1)).not.toHaveProperty("files");
  });

  it("drops descriptions of files that are no longer in the folder", async () => {
    const h = makeHarness();
    await h.seedPaper(P1, { title: "T", files: { "gone.txt": "old" } });
    await h.fs.mkdir(`${P1}/code`);
    await describePaperFileOnFileSystem(h.ctx, P1, "code", "Experiments");
    expect((await h.readMeta(P1))["files"]).toEqual({ code: "Experiments" });
  });

  it("refuses a name that is not in the paper folder", async () => {
    const h = makeHarness();
    await h.seedPaper(P1, { title: "T" });
    await expect(describePaperFileOnFileSystem(h.ctx, P1, "missing.txt", "x")).rejects.toThrow(/missing\.txt/);
  });

  it("refuses a hidden entry such as metadata.yaml", async () => {
    const h = makeHarness();
    await h.seedPaper(P1, { title: "T" });
    await expect(describePaperFileOnFileSystem(h.ctx, P1, "metadata.yaml", "x")).rejects.toThrow(/metadata\.yaml/);
  });

  it("returns undefined when the folder holds no paper", async () => {
    const h = makeHarness();
    await h.fs.mkdir(P1);
    expect(await describePaperFileOnFileSystem(h.ctx, P1, "a.txt", "x")).toBeUndefined();
  });
});

const STAMP = "2026-01-01T00:00:00.000Z";

function countKey(yaml: string, key: string): number {
  return yaml.split("\n").filter((line) => line.startsWith(`${key}:`)).length;
}

describe("setPapersTrashed", () => {
  it("stamps trashedAt with the clock and reads it back on the record", async () => {
    const h = makeHarness();
    await h.seedPaper(P1, { title: "T", status: "unread" });
    const outcome = await setPapersTrashed(h.ctx, [{ id: "p1", path: P1 }], true);
    expect(outcome.done).toEqual(["p1"]);
    expect(outcome.records[0]?.trashedAt).toBe(STAMP);
    expect(await h.readMeta(P1)).toMatchObject({ trashedAt: STAMP, title: "T" });
    expect((await readPaperOnFileSystem(h.ctx, P1))?.trashedAt).toBe(STAMP);
  });

  it("removes the key on restore", async () => {
    const h = makeHarness();
    await h.seedPaper(P1, { title: "T", trashedAt: "2025-05-05T10:00:00.000Z" });
    const outcome = await setPapersTrashed(h.ctx, [{ id: "p1", path: P1 }], false);
    expect(outcome.records[0]?.trashedAt).toBeUndefined();
    expect(await h.readMeta(P1)).not.toHaveProperty("trashedAt");
  });

  it("writes nothing when the paper is already in the asked state", async () => {
    const h = makeHarness();
    await h.seedPaper(P1, { title: "T", trashedAt: "2025-05-05T10:00:00.000Z" });
    const writes = h.fs.writes;
    await setPapersTrashed(h.ctx, [{ id: "p1", path: P1 }], true);
    expect(h.fs.writes).toBe(writes);
    expect((await h.readMeta(P1))["trashedAt"]).toBe("2025-05-05T10:00:00.000Z");
  });

  it("fails a missing paper and goes on", async () => {
    const h = makeHarness();
    await h.seedPaper(P1, { title: "T" });
    const outcome = await setPapersTrashed(h.ctx, [{ id: "x", path: `${PAPERS}/x` }, { id: "p1", path: P1 }], true);
    expect(outcome.done).toEqual(["p1"]);
    expect(outcome.failed.map((f) => f.id)).toEqual(["x"]);
  });
});

describe("trashedAt in metadata.yaml", () => {
  const TRASHED = "2025-05-05T10:00:00.000Z";

  it("survives a status change, a tag edit and a move, written once", async () => {
    const h = makeHarness();
    await h.seedPaper(P1, { title: "T", status: "unread", trashedAt: TRASHED });
    await updatePaperFields(h.ctx, P1, { status: "reading" });
    await updatePaperTags(h.ctx, [{ id: "p1", path: P1 }], ["NLP"], []);
    await h.fs.mkdir(`${PAPERS}/Bio`);
    await movePapers(h.ctx, [{ id: "p1", path: P1 }], `${PAPERS}/Bio`);
    const moved = `${PAPERS}/Bio/p1`;
    expect(await h.readMeta(moved)).toMatchObject({ trashedAt: TRASHED, status: "reading", tags: ["NLP"] });
    expect(countKey(await h.fs.readText(`${moved}/metadata.yaml`), "trashedAt")).toBe(1);
  });

  it("is kept by a rewrite from a record that does not know it, and set once by one that does", async () => {
    const h = makeHarness();
    await h.seedPaper(P1, { title: "T", trashedAt: TRASHED });
    const current = await readPaperOnFileSystem(h.ctx, P1);
    const { trashedAt: _drop, ...unknown } = current!;
    await writePaperRecord(h.ctx, { ...unknown, title: "New" }, { ownsStatus: false });
    expect(await h.readMeta(P1)).toMatchObject({ title: "New", trashedAt: TRASHED });
    await writePaperRecord(h.ctx, { ...current!, title: "Newer" }, { ownsStatus: false });
    const text = await h.fs.readText(`${P1}/metadata.yaml`);
    expect(countKey(text, "trashedAt")).toBe(1);
  });

  it("ignores a value that is not an ISO timestamp", async () => {
    const h = makeHarness();
    await h.seedPaper(P1, { title: "T", trashedAt: "yesterday" });
    expect((await readPaperOnFileSystem(h.ctx, P1))?.trashedAt).toBeUndefined();
  });
});
