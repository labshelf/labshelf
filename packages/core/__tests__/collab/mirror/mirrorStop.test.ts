/** Pins that a mirror which loses its folder lease or its folder stops touching disk and keeps every share edit. */
import { fileText, indexFiles, replaceFileText } from "../../../src/collab/model/index";
import { MirrorRootUnavailable, type MirrorStopReason } from "../../../src/collab/mirror/index";
import { MirrorOwnershipLost } from "../../../src/collab/ownership/index";
import { memoryFiles, nodeFiles } from "./mirrorFiles";
import { openMirror, type MirrorFixture } from "./mirrorFixture";

function peerFile(fixture: MirrorFixture, file: string, text: string): void {
  replaceFileText(fixture.session.openDoc(file), text, "remote");
  indexFiles(fixture.session.index).set(file, { kind: "text" });
}

describe.each([nodeFiles, memoryFiles()])("a stopping mirror over a $name", (files) => {
  let fixture: MirrorFixture;
  afterEach(async () => { await fixture.close(); });

  it("stops writing once the lease is lost mid-queue, and keeps peer edits in the share", async () => {
    let checks = 0;
    const ownership = {
      // The first check guards the first scan, the second lets one write through.
      assertOwned: async () => {
        checks += 1;
        if (checks > 2) { throw new MirrorOwnershipLost(fixture.folder, { app: "browser", renewedAt: 0 }); }
      },
    };
    const onStopped = jest.fn<void, [MirrorStopReason]>();
    fixture = await openMirror({ files, ownership, onStopped, project: false });
    await fixture.mirror.idle();
    ["a.typ", "b.typ", "c.typ"].forEach((file) => peerFile(fixture, file, `text of ${file}`));
    await fixture.mirror.idle();
    peerFile(fixture, "d.typ", "late");
    replaceFileText(fixture.session.openDoc("a.typ"), "edited", "remote");
    fixture.mirror.changed("b.typ");
    await fixture.mirror.idle();

    expect(fixture.diskChanges).toHaveLength(1);
    expect(onStopped).toHaveBeenCalledTimes(1);
    expect(onStopped.mock.calls[0]![0]).toBeInstanceOf(MirrorOwnershipLost);
    expect([...indexFiles(fixture.session.index).keys()].sort()).toEqual(["a.typ", "b.typ", "c.typ", "d.typ"]);
    expect(fileText(fixture.session.openDoc("a.typ")).toString()).toBe("edited");
    expect(fixture.logger.log.mock.calls.some(([level, , message]) => level === "WARN" && /stopped mirroring/i.test(message))).toBe(true);
  });

  it("stops without deleting share files when the project folder is gone", async () => {
    const onStopped = jest.fn<void, [MirrorStopReason]>();
    fixture = await openMirror({ files, onStopped });
    peerFile(fixture, "main.typ", "kept");
    await fixture.mirror.idle();
    await files.removeFolder(fixture.folder);
    fixture.mirror.changed("main.typ");
    await fixture.mirror.idle();
    peerFile(fixture, "other.typ", "after");
    await fixture.mirror.idle();

    expect(indexFiles(fixture.session.index).get("main.typ")).toEqual({ kind: "text" });
    expect(fileText(fixture.session.openDoc("main.typ")).toString()).toBe("kept");
    expect(onStopped).toHaveBeenCalledTimes(1);
    expect(onStopped.mock.calls[0]![0]).toBeInstanceOf(MirrorRootUnavailable);
    expect(await files.read(fixture.folder, "other.typ")).toBeUndefined();
  });
});
