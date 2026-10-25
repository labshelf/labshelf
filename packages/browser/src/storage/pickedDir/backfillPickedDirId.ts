// Gives a folder picked before folders carried a library id one, so its share keys get a library to live under.
// Delete when no installed extension can still hold a picked folder stored without a `libraryId` entry.
export async function backfillPickedFolderId(handle: FileSystemDirectoryHandle | undefined, save: (id: string) => Promise<void>): Promise<string | undefined> {
  if (handle === undefined) return undefined;
  const id = crypto.randomUUID();
  await save(id);
  return id;
}
