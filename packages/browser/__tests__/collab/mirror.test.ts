// The browser project mirror writes only to its library source, follows the caller's tab lease, and takes the page's own writes into the share at once.
import { addWriteRecord, deriveSha256Hex, readShareIndexDocFiles } from "@labshelf/core";
import { reportPageWrites } from "../../src/collab/mirror";
import { createTabLeaseName, openTabLease, updateTabLease } from "../../src/storage";
import { FOLDER, LIBRARY_ID, openTestbed, running, SHARE_ID, until, type Testbed } from "./mirrorTestbed";

// Pins that a browser project mirror writes only to the storage of its library source and follows edits made in a folder.
describe("mirrorSources", () => {
  const FILE = `${FOLDER}/main.typ`;

  describe("browser project mirror sources", () => {
    let bed: Testbed;
    afterEach(async () => { await bed.close(); });

    it("mirrors a peer edit to browser storage for a browser library", async () => {
      bed = await openTestbed("browser");
      const mirror = running(await bed.start());
      bed.peerEdit("main.typ", "Hello");
      mirror.changed("main.typ");
      await until(async () => (await bed.browserFs.text(FILE)) === "Hello");
      expect(bed.folderFs.writes).toEqual([]);
      expect(bed.stops).toEqual([]);
    });

    it("writes only to the folder for a folder library", async () => {
      bed = await openTestbed("folder");
      const mirror = running(await bed.start());
      bed.peerEdit("main.typ", "Hello");
      mirror.changed("main.typ");
      await until(async () => (await bed.folderFs.text(FILE)) === "Hello");
      await mirror.idle();
      expect(bed.browserFs.writes).toEqual([]);
    });

    it("takes an edit made in the folder outside the browser into the share on a rescan", async () => {
      bed = await openTestbed("folder");
      const mirror = running(await bed.start());
      bed.peerEdit("main.typ", "Hello");
      mirror.changed("main.typ");
      await until(async () => (await bed.folderFs.text(FILE)) === "Hello");
      await mirror.idle();
      bed.scheduler.fire();
      await mirror.idle();
      await bed.folderFs.writeText(FILE, "Hello from outside");
      await until(() => bed.docText("main.typ") === "Hello from outside", () => bed.scheduler.fire());
      expect(bed.stops).toEqual([]);
    });

    it("stops with root-unavailable when the folder permission is lost, leaving browser storage alone", async () => {
      bed = await openTestbed("folder");
      running(await bed.start());
      bed.folderFs.failing = true;
      await until(() => bed.stops.length > 0, () => bed.scheduler.fire());
      expect(bed.stops).toEqual(["root-unavailable"]);
      expect(bed.browserFs.writes).toEqual([]);
    });
  });
});

// Pins that the browser project mirror follows the caller's tab lease without releasing it, and that VS Code's folder lease keeps it busy.
describe("mirrorOwnership", () => {
  const FILE = `${FOLDER}/main.typ`;
  const TAB = createTabLeaseName(LIBRARY_ID, SHARE_ID);

  describe("browser project mirror ownership", () => {
    let bed: Testbed;
    afterEach(async () => { await bed.close(); });

    it("leaves the tab lease held by the caller when it closes", async () => {
      bed = await openTestbed("browser");
      await running(await bed.start()).close();
      expect(await openTabLease(TAB)).toEqual({ kind: "busy" });
      expect(bed.stops).toEqual([]);
    });

    it("stops and writes nothing to disk once another tab took the tab lease", async () => {
      bed = await openTestbed("browser");
      const mirror = running(await bed.start());
      const stolen = await updateTabLease(TAB);
      await until(() => bed.stops.length > 0);
      expect(bed.stops).toEqual(["tab-taken"]);
      bed.peerEdit("main.typ", "Hello");
      mirror.changed("main.typ");
      await mirror.idle();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(bed.browserFs.writes).toEqual([]);
      await stolen.release();
    });

    it("is busy with the folder holder while VS Code holds a live folder lease, until it takes over", async () => {
      bed = await openTestbed("folder");
      const lease = { owner: "vscode-owner", app: "vscode", renewedAt: Date.now(), ttlMs: 30_000 };
      await bed.folderFs.writeText(`${FOLDER}/.labshelf/mirror-lease.json`, JSON.stringify(lease));
      const result = await bed.start();
      if (result.kind !== "busy") { throw new Error("expected busy"); }
      expect(result.holder).toEqual({ app: "vscode", renewedAt: lease.renewedAt });
      const mirror = running(await result.takeOver());
      bed.peerEdit("main.typ", "Hello");
      mirror.changed("main.typ");
      await until(async () => (await bed.folderFs.text(FILE)) === "Hello");
      expect(bed.stops).toEqual([]);
    });
  });
});

// Pins that files the page writes in a shared project reach the share at once, with no rescan: created, renamed and binary files.
describe("mirrorLocalChanges", () => {
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
      await until(() => { const files = readShareIndexDocFiles(bed.session.index); return files.has("chapter1.tex") && !files.has("intro.tex"); });
      expect(bed.docText("chapter1.tex")).toBe("Intro");
    });

    it("shares an image the page copies into a folder library as a blob, before any rescan", async () => {
      bed = await openTestbed("folder");
      const mirror = running(await bed.start());
      await mirror.idle();
      const pageFs = reportPageWrites(bed.folderFs);
      await pageFs.writeFile(`${FOLDER}/images/plot.png`, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]));
      await pageFs.writeText("projects/other/ignored.tex", "outside the share");
      await until(() => readShareIndexDocFiles(bed.session.index).get("images/plot.png")?.kind === "blob");
      expect(readShareIndexDocFiles(bed.session.index).get("images/plot.png")?.hash).toMatch(/^[0-9a-f]{64}$/);
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
      await addWriteRecord(bed.folderFs, FOLDER, "11111111-1111-4111-8111-111111111111", {
        path: "main.tex", hash: await deriveSha256Hex(new TextEncoder().encode("Cloud")), parent: null, by: "mirror", at: 1,
      }, bed.logger);
      const waiting = () => (bed.logger.log as jest.Mock).mock.calls.some(call => call[2] === "Waiting for an in-flight mirror write");
      await until(waiting, () => bed.scheduler.fire());
      expect(bed.docText("main.tex")).toBe("Base");
    });
  });
});
