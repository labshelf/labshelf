import { firstRunChoices } from "../../../src/cli/libraryLocation/firstRunChoices";

describe("firstRunChoices", () => {
  const home = "/home/ada";

  it("lists each detected sync folder, then the local folder, a custom path and the guide", () => {
    const choices = firstRunChoices([{ tool: "dropbox", path: "/home/ada/Dropbox" }, { tool: "googledrive", path: "/mnt/Drive/My Drive" }], home);
    expect(choices.map((c) => c.kind)).toEqual(["folder", "folder", "folder", "custom", "guide"]);
    expect(choices[0]).toMatchObject({ path: "/home/ada/Dropbox/LabShelf", label: "~/Dropbox/LabShelf", detail: "synced by Dropbox" });
    expect(choices[1]).toMatchObject({ path: "/mnt/Drive/My Drive/LabShelf", label: "/mnt/Drive/My Drive/LabShelf", detail: "synced by Google Drive" });
    expect(choices[2]).toMatchObject({ path: "/home/ada/LabShelf", label: "~/LabShelf", detail: "only on this computer" });
  });

  it("offers the local folder, a custom path and the guide when nothing is detected", () => {
    expect(firstRunChoices([], home).map((c) => c.label)).toEqual(["~/LabShelf", "Choose a folder…", "How to sync between computers"]);
  });
});
