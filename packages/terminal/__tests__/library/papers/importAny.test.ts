import { promises as fs } from "node:fs";
import * as path from "node:path";

import { ATTENTION, harness, metaFile } from "../../fixtures/paperService";
import { cleanupTempDirs } from "../../fixtures/library";

afterEach(cleanupTempDirs);

describe("importAny with local files", () => {
  it("imports a PDF file, reloads the store and announces the change once", async () => {
    const h = await harness([], ["ML"]);
    const outcomes = await h.service.importAny([await h.writePdf()], "ML");

    expect(outcomes.map((o) => o.status)).toEqual(["added"]);
    expect(h.store.paper("vaswani2017attention")).toMatchObject({ collection: "ML" });
    expect(h.onLocalChange).toHaveBeenCalledTimes(1);
  });

  it("does not announce a change when nothing was added", async () => {
    const h = await harness([{ id: "have", meta: { doi: ATTENTION.doi } }]);
    const outcomes = await h.service.importAny([await h.writePdf(), path.join(h.inbox, "nope.txt")], "");
    expect(outcomes.map((o) => o.status)).toEqual(["duplicate", "failed"]);
    expect(h.onLocalChange).not.toHaveBeenCalled();
  });

  it("imports every PDF in a folder, in path order, and reports progress per file", async () => {
    const h = await harness();
    h.parse.mockImplementation(async (_bytes, stem) => ({ title: stem, citeKey: stem.toLowerCase(), authors: [], confidence: "high" }));
    await h.writePdf("dir/b.pdf");
    await h.writePdf("dir/a.pdf");
    await h.writePdf("dir/sub/C.PDF");
    const progress: Array<{ index: number; total: number; input: string }> = [];

    const outcomes = await h.service.importAny([path.join(h.inbox, "dir")], "", (p) => progress.push(p));

    expect(outcomes.map((o) => (o.status === "added" ? o.record.id : o.status))).toEqual(["a", "b", "c"]);
    expect(progress.map((p) => [p.index, p.total])).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it("carries on with the other items when one fails", async () => {
    const h = await harness();
    const bad = await h.writePdf("bad.pdf", "<html>no</html>");
    const outcomes = await h.service.importAny([bad, await h.writePdf("good.pdf")], "");
    expect(outcomes.map((o) => o.status)).toEqual(["failed", "added"]);
  });

  it("lets later items see the ids earlier ones took", async () => {
    const h = await harness();
    h.parse.mockImplementation(async (_b, stem) => ({ title: stem, citeKey: "same", authors: [], confidence: "high", doi: `10.1000/${stem}` }));
    const outcomes = await h.service.importAny([await h.writePdf("one.pdf"), await h.writePdf("two.pdf")], "");
    expect(outcomes.map((o) => (o.status === "added" ? o.record.id : o.status))).toEqual(["same", "samea"]);
  });

  it("skips a symlink instead of following it", async () => {
    const h = await harness();
    const real = await h.writePdf("real.pdf");
    const link = path.join(h.inbox, "link.pdf");
    await fs.symlink(real, link);
    const outcomes = await h.service.importAny([link], "");
    expect(outcomes).toEqual([{ status: "skipped", input: link }]);
    expect(h.parse).not.toHaveBeenCalled();
  });

  it("ignores blank inputs and folders without PDFs", async () => {
    const h = await harness();
    expect(await h.service.importAny(["", "   "], "")).toEqual([]);
    await fs.mkdir(path.join(h.inbox, "empty"));
    expect(await h.service.importAny([path.join(h.inbox, "empty")], "")).toEqual([]);
  });

  it("writes the metadata the parser found", async () => {
    const h = await harness();
    await h.service.importAny([await h.writePdf()], "");
    expect(await fs.readFile(metaFile(h, "vaswani2017attention"), "utf8")).toContain("Attention Is All You Need");
  });

  it("imports local PDFs, then reports skipped paths, then imports network inputs, counting progress over both", async () => {
    const h = await harness();
    h.resolve.mockResolvedValue({ title: "Nanometre-scale thermometry in a living cell", authors: ["G. Kucsko"], year: 2013 });
    const link = path.join(h.inbox, "link.pdf");
    await fs.symlink(await h.writePdf("real.pdf"), link);
    const progress: Array<[number, number, string]> = [];

    const outcomes = await h.service.importAny(["10.1038/nature12373", link, await h.writePdf()], "", (p) => progress.push([p.index, p.total, p.input]));

    expect(outcomes.map((o) => (o.status === "added" ? o.record.id : `${o.status} ${o.input}`))).toEqual([
      "vaswani2017attention", `skipped ${link}`, "kucsko2013nanometre",
    ]);
    expect(progress).toEqual([[1, 2, path.join(h.inbox, "attention.pdf")], [2, 2, "10.1038/nature12373"]]);
    expect(h.store.paper("kucsko2013nanometre")).toBeDefined();
    expect(h.onLocalChange).toHaveBeenCalledTimes(1);
  });
});
