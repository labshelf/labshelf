import { describePaperFileOnDisk } from "@labshelf/core";

import { makeHarness, PAPERS } from "../../support/mutationHarness";

const P1 = `${PAPERS}/ML/p1`;

describe("describePaperFileOnDisk", () => {
  it("writes the description under the files key and keeps every other field", async () => {
    const h = makeHarness();
    await h.seedPaper(P1, { title: "T", status: "reading", tags: ["NLP"], note: "n", customKey: "keep" });
    await h.fs.writeText(`${P1}/slides.pdf`, "x");
    const record = await describePaperFileOnDisk(h.ctx, P1, "slides.pdf", "  Talk slides ");
    expect(await h.readMeta(P1)).toMatchObject({
      title: "T", status: "reading", tags: ["NLP"], note: "n", customKey: "keep", files: { "slides.pdf": "Talk slides" },
    });
    expect(record?.files).toEqual({ "slides.pdf": "Talk slides" });
  });

  it("removes the files key when the last description is cleared", async () => {
    const h = makeHarness();
    await h.seedPaper(P1, { title: "T", files: { "slides.pdf": "Talk slides" } });
    await h.fs.writeText(`${P1}/slides.pdf`, "x");
    await describePaperFileOnDisk(h.ctx, P1, "slides.pdf", "");
    expect(await h.readMeta(P1)).not.toHaveProperty("files");
  });

  it("drops descriptions of files that are no longer in the folder", async () => {
    const h = makeHarness();
    await h.seedPaper(P1, { title: "T", files: { "gone.txt": "old" } });
    await h.fs.mkdir(`${P1}/code`);
    await describePaperFileOnDisk(h.ctx, P1, "code", "Experiments");
    expect((await h.readMeta(P1))["files"]).toEqual({ code: "Experiments" });
  });

  it("refuses a name that is not in the paper folder", async () => {
    const h = makeHarness();
    await h.seedPaper(P1, { title: "T" });
    await expect(describePaperFileOnDisk(h.ctx, P1, "missing.txt", "x")).rejects.toThrow(/missing\.txt/);
  });

  it("refuses a hidden entry such as metadata.yaml", async () => {
    const h = makeHarness();
    await h.seedPaper(P1, { title: "T" });
    await expect(describePaperFileOnDisk(h.ctx, P1, "metadata.yaml", "x")).rejects.toThrow(/metadata\.yaml/);
  });

  it("returns undefined when the folder holds no paper", async () => {
    const h = makeHarness();
    await h.fs.mkdir(P1);
    expect(await describePaperFileOnDisk(h.ctx, P1, "a.txt", "x")).toBeUndefined();
  });
});
