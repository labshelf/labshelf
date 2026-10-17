import { posixPathOps, scanLibrary } from "@labshelf/core";

import { makeHarness, PAPERS, type MutationHarness } from "../../support/mutationHarness";

const scan = (h: MutationHarness) => scanLibrary(h.fs, posixPathOps, PAPERS, h.ctx.logger);
const ids = (papers: Array<{ record: { id: string } }>): string[] => papers.map((p) => p.record.id);

describe("scanLibrary: structure", () => {
  it("finds papers in nested collections and lists every collection, empty ones too", async () => {
    const h = makeHarness();
    await h.seedPaper(`${PAPERS}/top`, { title: "Top" });
    await h.seedPaper(`${PAPERS}/ML/Vision/resnet`, { title: "ResNet" });
    await h.fs.mkdir(`${PAPERS}/Empty`);
    const result = await scan(h);
    expect(ids(result.papers)).toEqual(["resnet", "top"]);
    expect(result.folders).toEqual(["Empty", "ML", "ML/Vision"]);
    expect(result.papers.find((p) => p.record.id === "resnet")).toMatchObject({ collection: "ML/Vision" });
    expect(result.papers.find((p) => p.record.id === "top")).toMatchObject({ collection: "" });
  });

  it("returns an empty scan for a missing papers folder", async () => {
    const h = makeHarness();
    h.fs.dirs.delete(PAPERS);
    expect(await scan(h)).toEqual({ papers: [], folders: [], orphans: [], duplicates: [] });
  });

  it("skips every dot entry, including the browser's .keep sentinel", async () => {
    const h = makeHarness();
    await h.seedPaper(`${PAPERS}/.trash/hidden`, { title: "Hidden" });
    await h.fs.writeText(`${PAPERS}/Notes/.keep`, "");
    await h.fs.writeText(`${PAPERS}/.DS_Store`, "");
    const result = await scan(h);
    expect(result.papers).toEqual([]);
    expect(result.folders).toEqual(["Notes"]);
  });

  it("reports a folder that holds only paper.pdf as an orphan, not as a paper or a collection", async () => {
    const h = makeHarness();
    await h.fs.writeText(`${PAPERS}/loose/paper.pdf`, "x");
    await h.seedPaper(`${PAPERS}/ML/real`, { title: "Real" });
    const result = await scan(h);
    expect(result.orphans).toEqual([`${PAPERS}/loose`]);
    expect(result.folders).toEqual(["ML"]);
    expect(ids(result.papers)).toEqual(["real"]);
  });
});

describe("scanLibrary: papers", () => {
  it("sets hasPdf and pdfBytes from the exact file name paper.pdf only", async () => {
    const h = makeHarness();
    await h.seedPaper(`${PAPERS}/with`, { title: "With" });
    await h.seedPaper(`${PAPERS}/without`, { title: "Without" }, { pdf: false });
    await h.fs.writeText(`${PAPERS}/without/paper (conflict 2026-05-22).pdf`, "x");
    await h.fs.writeText(`${PAPERS}/without/Paper.pdf`, "x");
    const byId = new Map((await scan(h)).papers.map((p) => [p.record.id, p]));
    expect(byId.get("with")!.record.hasPdf).toBe(true);
    expect(byId.get("with")!.pdfBytes).toBeGreaterThan(0);
    expect(byId.get("without")!.record.hasPdf).toBe(false);
    expect(byId.get("without")!.pdfBytes).toBeUndefined();
  });

  it("skips a folder with invalid metadata and logs a warning naming it", async () => {
    const h = makeHarness();
    await h.fs.writeText(`${PAPERS}/bad/metadata.yaml`, "- just\n- a list\n");
    await h.fs.writeText(`${PAPERS}/broken/metadata.yaml`, "title: [unclosed");
    await h.seedPaper(`${PAPERS}/good`, { title: "Good" });
    const result = await scan(h);
    expect(ids(result.papers)).toEqual(["good"]);
    const warned = h.logs.filter((l) => l.level === "WARN").map((l) => l.context?.["folder"]);
    expect(warned).toEqual(expect.arrayContaining([`${PAPERS}/bad`, `${PAPERS}/broken`]));
  });

  it("counts a symlinked metadata.yaml, paper.pdf or folder as absent", async () => {
    const h = makeHarness();
    await h.seedPaper(`${PAPERS}/pdf-linked`, { title: "A" }, { pdf: false });
    h.fs.symlinks.add(`${PAPERS}/pdf-linked/paper.pdf`);
    await h.fs.writeText(`${PAPERS}/meta-linked/paper.pdf`, "x");
    h.fs.symlinks.add(`${PAPERS}/meta-linked/metadata.yaml`);
    h.fs.symlinks.add(`${PAPERS}/folder-linked`);
    const result = await scan(h);
    expect(result.papers.map((p) => [p.record.id, p.record.hasPdf])).toEqual([["pdf-linked", false]]);
    expect(result.orphans).toEqual([`${PAPERS}/meta-linked`]);
    expect(result.folders).toEqual([]);
  });

  it("keeps the first folder in path order for a duplicate id and logs the others", async () => {
    const h = makeHarness();
    await h.seedPaper(`${PAPERS}/b/dup`, { title: "second" });
    await h.seedPaper(`${PAPERS}/a/dup`, { title: "first" });
    await h.seedPaper(`${PAPERS}/c/dup`, { title: "third" });
    const result = await scan(h);
    expect(result.papers.map((p) => p.record.title)).toEqual(["first"]);
    expect(result.duplicates).toEqual([`${PAPERS}/b/dup`, `${PAPERS}/c/dup`]);
    expect(h.logs.filter((l) => l.level === "WARN").map((l) => l.context?.["folder"])).toEqual([`${PAPERS}/b/dup`, `${PAPERS}/c/dup`]);
  });
});

describe("scanLibrary: unreadable folders", () => {
  it("logs and skips a folder whose listing throws, and scans the rest", async () => {
    const h = makeHarness();
    await h.seedPaper(`${PAPERS}/ok/p1`, { title: "One" });
    await h.seedPaper(`${PAPERS}/locked/p2`, { title: "Two" });
    h.fs.unreadable.add(`${PAPERS}/locked`);
    const result = await scan(h);
    expect(ids(result.papers)).toEqual(["p1"]);
    expect(h.logs.some((l) => l.level === "WARN" && l.context?.["path"] === `${PAPERS}/locked`)).toBe(true);
  });

  it("fails when papers/ itself cannot be listed, so a reindex never mistakes it for an empty library", async () => {
    const h = makeHarness();
    h.fs.unreadable.add(PAPERS);
    await expect(scan(h)).rejects.toThrow("EACCES");
  });
});

describe("scanLibrary: metadata.yaml that fails to parse", () => {
  const previousOf = async (h: MutationHarness) => new Map((await scan(h)).papers.map((p) => [p.record.path, p]));

  it.each([["unclosed YAML", "title: [unclosed\n"], ["plain text", "just some text"], ["empty file", ""]])(
    "keeps the previous record and logs a WARN for %s, then reads the paper again once the file is valid",
    async (_name, broken) => {
      const h = makeHarness();
      await h.seedPaper(`${PAPERS}/ML/p1`, { title: "One" });
      await h.seedPaper(`${PAPERS}/p2`, { title: "Two" });
      const previous = await previousOf(h);
      const metadata = `${PAPERS}/ML/p1/metadata.yaml`;
      const good = await h.fs.readText(metadata);

      await h.fs.writeText(metadata, broken);
      const kept = await scanLibrary(h.fs, posixPathOps, PAPERS, h.ctx.logger, previous);
      expect(ids(kept.papers)).toEqual(["p1", "p2"]);
      expect(kept.papers.find((p) => p.record.id === "p1")).toMatchObject({ record: { title: "One" }, collection: "ML" });
      expect(h.logs.some((l) => l.level === "WARN" && l.context?.["folder"] === `${PAPERS}/ML/p1`)).toBe(true);

      await h.fs.writeText(metadata, good.replace("One", "Renamed"));
      const retried = await scanLibrary(h.fs, posixPathOps, PAPERS, h.ctx.logger, previous);
      expect(retried.papers.find((p) => p.record.id === "p1")?.record.title).toBe("Renamed");
    },
  );

  it("still drops a paper whose folder is gone and skips a broken paper that was never indexed", async () => {
    const h = makeHarness();
    await h.seedPaper(`${PAPERS}/p1`, { title: "One" });
    const previous = await previousOf(h);
    await h.fs.trash(`${PAPERS}/p1`);
    await h.fs.writeText(`${PAPERS}/new/metadata.yaml`, "just some text");
    const result = await scanLibrary(h.fs, posixPathOps, PAPERS, h.ctx.logger, previous);
    expect(result.papers).toEqual([]);
  });
});
