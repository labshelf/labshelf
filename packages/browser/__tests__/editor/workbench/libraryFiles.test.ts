// Pins how the editor page renames library files outside projects/: a staged write replaces its target only when asked to.
// monaco-vscode-api ships ES modules jest cannot load; the provider errors only need their message here.
jest.mock("@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files", () => ({
  createFileSystemProviderError: (message: string) => new Error(message),
  FileSystemProviderErrorCode: { FileExists: "EntryExists", FileNotFound: "EntryNotFound", Unavailable: "Unavailable" },
  FileType: { File: 1, Directory: 2 },
}));

import { MemoryFolderFs } from "../../storage/move/memoryFolderFs";
import { createLibraryFiles } from "../../../src/editor/workbench/libraryFiles";

function setup() {
  const fileSystem = new MemoryFolderFs();
  fileSystem.put("labshelf.bib", "old");
  fileSystem.put(".labshelf.bib.1234.tmp", "new");
  const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
  return { fileSystem, files: createLibraryFiles(fileSystem, logger) };
}

describe("library files rename", () => {
  it("replaces an existing target when the workbench asks to overwrite it", async () => {
    const { fileSystem, files } = setup();
    await files.rename(".labshelf.bib.1234.tmp", "labshelf.bib", { overwrite: true });
    expect(fileSystem.text("labshelf.bib")).toBe("new");
    expect(fileSystem.files.has(".labshelf.bib.1234.tmp")).toBe(false);
  });

  it("refuses an existing target without overwrite and keeps both files", async () => {
    const { fileSystem, files } = setup();
    await expect(files.rename(".labshelf.bib.1234.tmp", "labshelf.bib", { overwrite: false })).rejects.toThrow(/exists/);
    expect(fileSystem.text("labshelf.bib")).toBe("old");
    expect(fileSystem.text(".labshelf.bib.1234.tmp")).toBe("new");
  });

  it("moves a file to a free name", async () => {
    const { fileSystem, files } = setup();
    await files.rename(".labshelf.bib.1234.tmp", "other.bib", { overwrite: false });
    expect(fileSystem.text("other.bib")).toBe("new");
  });
});
