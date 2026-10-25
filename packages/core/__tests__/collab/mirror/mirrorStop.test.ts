/** Pins that a mirror which loses its folder lease or its folder stops touching disk and keeps every share edit. */
import { readFileText, readShareIndexDocFiles, setFileText } from "../../../src/collab/model/index";
import { MirrorProjectDirUnavailable, type MirrorStopReason } from "../../../src/collab/mirror/index";
import { MirrorOwnershipLost } from "../../../src/collab/mirror/mirrorLostError";
import { memoryFiles, nodeFiles } from "./mirrorFiles";
import { openMirror, type MirrorFixture } from "./mirrorFixture";

function peerFile(fixture: MirrorFixture, file: string, text: string): void {
  setFileText(fixture.session.openDoc(file), text, "remote");
  readShareIndexDocFiles(fixture.session.index).set(file, { kind: "text" });
}

describe.each([nodeFiles, memoryFiles()])("a stopping mirror over a $name", (files) => {
  let fixture: MirrorFixture;
  afterEach(async () => { await fixture.close(); });

  it("stops writing once the lease is lost mid-queue, and keeps peer edits in the share", async () => {
    const ownership = {
      assertOwned: async () => {
        if (fixture?.diskChanges.length > 0) { throw new MirrorOwnershipLost(fixture.folder, { app: "browser", renewedAt: 0 }); }
      },
    };
    const onStopped = jest.fn<void, [MirrorStopReason]>();
    fixture = await openMirror({ files, ownership, onStopped, project: false });
    await fixture.mirror.idle();
    ["a.typ", "b.typ", "c.typ"].forEach((file) => peerFile(fixture, file, `text of ${file}`));
    await fixture.mirror.idle();
    peerFile(fixture, "d.typ", "late");
    setFileText(fixture.session.openDoc("a.typ"), "edited", "remote");
    fixture.mirror.changed("b.typ");
    await fixture.mirror.idle();

    expect(fixture.diskChanges).toHaveLength(1);
    expect(onStopped).toHaveBeenCalledTimes(1);
    expect(onStopped.mock.calls[0]![0]).toBeInstanceOf(MirrorOwnershipLost);
    expect([...readShareIndexDocFiles(fixture.session.index).keys()].sort()).toEqual(["a.typ", "b.typ", "c.typ", "d.typ"]);
    expect(readFileText(fixture.session.openDoc("a.typ")).toString()).toBe("edited");
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

    expect(readShareIndexDocFiles(fixture.session.index).get("main.typ")).toEqual({ kind: "text" });
    expect(readFileText(fixture.session.openDoc("main.typ")).toString()).toBe("kept");
    expect(onStopped).toHaveBeenCalledTimes(1);
    expect(onStopped.mock.calls[0]![0]).toBeInstanceOf(MirrorProjectDirUnavailable);
    expect(await files.read(fixture.folder, "other.typ")).toBeUndefined();
  });
});
