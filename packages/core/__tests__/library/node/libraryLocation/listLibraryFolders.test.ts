import { listLibraryFolders } from "../../../../src/library/node/libraryLocation/listLibraryFolders";

describe("listLibraryFolders", () => {
  it("lists each sync folder's LabShelf folder, then the local one", () => {
    expect(listLibraryFolders([{ tool: "dropbox", path: "/home/me/Dropbox" }], "/home/me")).toEqual([
      { path: "/home/me/Dropbox/LabShelf", label: "~/Dropbox/LabShelf", detail: "synced by Dropbox" },
      { path: "/home/me/LabShelf", label: "~/LabShelf", detail: "only on this computer" },
    ]);
  });
});
