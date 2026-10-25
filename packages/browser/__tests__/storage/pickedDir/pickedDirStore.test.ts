// Pins the library id kept with the picked folder: stable across loads, kept on a re-pick of the same folder, and given to a folder stored without one.
const rows = new Map<string, unknown>();
jest.mock("idb", () => ({
  openDB: async () => ({
    get: async (_store: string, key: string) => rows.get(key),
    put: async (_store: string, value: unknown, key: string) => { rows.set(key, value); },
  }),
}));

import { loadPickedFolder, loadPickedFolderId, savePickedFolder } from "../../../src/storage/pickedDir";
import { FakeDir } from "../../support/fakeDirectoryHandle";

const asHandle = (dir: FakeDir): FileSystemDirectoryHandle => dir as unknown as FileSystemDirectoryHandle;

beforeEach(() => rows.clear());

describe("picked folder library id", () => {
  it("gives a picked folder an id that later loads return", async () => {
    const papers = asHandle(new FakeDir("Papers"));
    await savePickedFolder(papers);
    const id = await loadPickedFolderId();
    expect(id).toMatch(/^[\w-]{16,}$/);
    expect(await loadPickedFolderId()).toBe(id);
    expect(await loadPickedFolder()).toBe(papers);
  });

  it("keeps the id when the same folder is picked again and changes it for another folder", async () => {
    const papers = asHandle(new FakeDir("Papers"));
    await savePickedFolder(papers);
    const first = await loadPickedFolderId();
    await savePickedFolder(papers);
    expect(await loadPickedFolderId()).toBe(first);
    await savePickedFolder(asHandle(new FakeDir("Papers")));
    expect(await loadPickedFolderId()).not.toBe(first);
  });

  it("gives a folder stored without an id one id and keeps it", async () => {
    rows.set("library", new FakeDir("Papers"));
    const id = await loadPickedFolderId();
    expect(id).toBeDefined();
    expect(await loadPickedFolderId()).toBe(id);
  });

  it("has no id when no folder was picked", async () => {
    expect(await loadPickedFolderId()).toBeUndefined();
  });
});
