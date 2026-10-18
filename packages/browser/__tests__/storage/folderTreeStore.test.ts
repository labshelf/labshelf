// Pins that the folder tree and PDF-presence set come from walking the active library source.
import type { LibraryFileSystem, LocalStat } from "@labshelf/core";

const files = new Set<string>();
const dirs = new Set<string>();
const stat = (isDirectory: boolean): LocalStat => ({ isFile: !isDirectory, isDirectory, mtimeMs: 0, size: 0 });
const mockFs: Pick<LibraryFileSystem, "listDir" | "stat"> = {
  listDir: async (dir) => [...files, ...dirs].filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes("/")).map((p) => p.slice(dir.length + 1)),
  stat: async (path) => (files.has(path) ? stat(false) : dirs.has(path) ? stat(true) : undefined),
};
jest.mock("../../src/storage/libraryFileSystem", () => ({ createLibraryFileSystem: () => mockFs }));

import { buildFolderTree, pdfDirs, scanLibrary } from "../../src/storage/folderTreeStore";

function seed(fileList: string[], dirList: string[]): void {
  files.clear(); dirs.clear();
  fileList.forEach((p) => files.add(p));
  dirList.forEach((p) => dirs.add(p));
}

beforeEach(() => seed(
  ["papers/Thesis/smith/metadata.yaml", "papers/Thesis/smith/paper.pdf", "papers/Kept/.keep", "papers/lee/metadata.yaml"],
  ["papers", "papers/Thesis", "papers/Thesis/smith", "papers/Kept", "papers/Empty", "papers/lee", "papers/.hidden"],
));

describe("folderTreeStore", () => {
  it("builds the collection tree from the source's files and folders, keeping empty ones", async () => {
    const names = (await buildFolderTree()).map((node) => node.name);
    expect(names).toEqual(["Empty", "Kept", "Thesis"]);
  });

  it("scans the tree and the folders holding a paper.pdf in one walk", async () => {
    const scan = await scanLibrary();
    expect(scan.tree.find((node) => node.name === "Thesis")?.children).toEqual([]);
    expect([...scan.pdfDirs]).toEqual(["papers/Thesis/smith"]);
    await expect(pdfDirs()).resolves.toEqual(new Set(["papers/Thesis/smith"]));
  });

  it("answers an empty tree for a library without a papers folder", async () => {
    seed([], []);
    await expect(buildFolderTree()).resolves.toEqual([]);
  });
});
