/** Pins that files the page writes in a shared project reach the share at once, with no rescan: created, renamed and binary files. */
import { indexFiles } from "@labshelf/core";
import { reportLocalFileChanges } from "../../../../../src/library-page/editor/collab/mirror";
import { FOLDER, openTestbed, running, until, type Testbed } from "./mirrorTestbed";

describe("browser project mirror and the page's own writes", () => {
  let bed: Testbed;
  afterEach(async () => { await bed.close(); });

  it("shares a file the page creates and follows its rename, in a browser library", async () => {
    bed = await openTestbed("browser");
    const mirror = running(await bed.start());
    await mirror.idle();
    await bed.browserFs.writeText(`${FOLDER}/intro.tex`, "Intro");
    reportLocalFileChanges([`${FOLDER}/intro.tex`]);
    await until(() => bed.docText("intro.tex") === "Intro");
    await mirror.idle();
    await bed.browserFs.rename(`${FOLDER}/intro.tex`, `${FOLDER}/chapter1.tex`);
    reportLocalFileChanges([`${FOLDER}/intro.tex`, `${FOLDER}/chapter1.tex`]);
    await until(() => { const files = indexFiles(bed.session.index); return files.has("chapter1.tex") && !files.has("intro.tex"); });
    expect(bed.docText("chapter1.tex")).toBe("Intro");
  });

  it("shares an image the page copies into a folder library as a blob, before any rescan", async () => {
    bed = await openTestbed("folder");
    const mirror = running(await bed.start());
    await mirror.idle();
    await bed.folderFs.writeFile(`${FOLDER}/images/plot.png`, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]));
    reportLocalFileChanges([`${FOLDER}/images/plot.png`, "projects/other/ignored.tex"]);
    await until(() => indexFiles(bed.session.index).get("images/plot.png")?.kind === "blob");
    expect(indexFiles(bed.session.index).get("images/plot.png")?.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
