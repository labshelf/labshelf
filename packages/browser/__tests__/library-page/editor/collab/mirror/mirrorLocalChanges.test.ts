/** Pins that files the page writes in a shared project reach the share at once, with no rescan: created, renamed and binary files. */
import { appendWriteRecord, indexFiles, sha256Hex } from "@labshelf/core";
import { reportPageWrites } from "../../../../../src/library-page/editor/collab/mirror";
import { FOLDER, openTestbed, running, until, type Testbed } from "./mirrorTestbed";

describe("browser project mirror and the page's own writes", () => {
  let bed: Testbed;
  afterEach(async () => { await bed.close(); });

  it("shares a file the page creates and follows its rename, in a browser library", async () => {
    bed = await openTestbed("browser");
    const mirror = running(await bed.start());
    await mirror.idle();
    const pageFs = reportPageWrites(bed.browserFs);
    await pageFs.writeText(`${FOLDER}/intro.tex`, "Intro");
    await until(() => bed.docText("intro.tex") === "Intro");
    await mirror.idle();
    await pageFs.rename(`${FOLDER}/intro.tex`, `${FOLDER}/chapter1.tex`);
    await until(() => { const files = indexFiles(bed.session.index); return files.has("chapter1.tex") && !files.has("intro.tex"); });
    expect(bed.docText("chapter1.tex")).toBe("Intro");
  });

  it("shares an image the page copies into a folder library as a blob, before any rescan", async () => {
    bed = await openTestbed("folder");
    const mirror = running(await bed.start());
    await mirror.idle();
    const pageFs = reportPageWrites(bed.folderFs);
    await pageFs.writeFile(`${FOLDER}/images/plot.png`, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]));
    await pageFs.writeText("projects/other/ignored.tex", "outside the share");
    await until(() => indexFiles(bed.session.index).get("images/plot.png")?.kind === "blob");
    expect(indexFiles(bed.session.index).get("images/plot.png")?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rescans cloud record files that arrive after their source file", async () => {
    bed = await openTestbed("folder");
    bed.peerEdit("main.tex", "Base");
    const mirror = running(await bed.start());
    await mirror.idle();
    const roundTrip = jest.fn(() => new Promise<boolean>(() => undefined));
    bed.session.registerIndexRoundTrip(roundTrip);
    await bed.folderFs.writeText(`${FOLDER}/main.tex`, "Cloud");
    await until(() => roundTrip.mock.calls.length > 0, () => bed.scheduler.fire());
    await appendWriteRecord(bed.folderFs, FOLDER, "11111111-1111-4111-8111-111111111111", {
      path: "main.tex", hash: await sha256Hex(new TextEncoder().encode("Cloud")), parent: null, by: "mirror", at: 1,
    }, bed.logger);
    const waiting = () => (bed.logger.log as jest.Mock).mock.calls.some(call => call[2] === "Waiting for an in-flight mirror write");
    await until(waiting, () => bed.scheduler.fire());
    expect(bed.docText("main.tex")).toBe("Base");
  });
});
