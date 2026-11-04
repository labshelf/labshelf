/** Pins that the project profile, loaded through the package index as every app loads core, shares labshelf.yaml. */
// TRAP: this import must stay first; loading the package index before any deeper module is what reproduces the apps' load order.
import { readShareIndexDocSettings, readSettingsMap } from "../../../src/index";
import { nodeFiles } from "./mirrorFiles";
import { openMirror, type MirrorFixture } from "./mirrorFixture";

describe("project mirror loaded through the package index", () => {
  let fixture: MirrorFixture | undefined;
  afterEach(async () => { await fixture?.close(); fixture = undefined; });

  it("takes the settings of the project's labshelf.yaml into the share", async () => {
    const folder = await nodeFiles.newFolder("mirror-index-load");
    await nodeFiles.write(folder, "labshelf.yaml", "id: p\nformat: typst\nmain: main.typ\n");
    fixture = await openMirror({ folder });
    await fixture.mirror.idle();
    expect(readSettingsMap(readShareIndexDocSettings(fixture.session.index))).toEqual({ format: "typst", main: "main.typ" });
  });
});
