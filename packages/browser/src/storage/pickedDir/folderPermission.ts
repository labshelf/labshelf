// Checks and asks for the browser's permission to read and write the picked library folder.
const READ_WRITE = { mode: "readwrite" } as const;

/** Thrown by every call on a picked folder the browser does not currently let LabShelf use. */
export class FolderAccessError extends Error {
  constructor(folderName: string) {
    super(`LabShelf may not use the folder "${folderName}" until you allow it again: open the library and choose Allow access.`);
    this.name = "FolderAccessError";
  }
}

/** PLATFORM: a context without the permission API (a service worker) reports "granted" and lets the call itself fail. */
export async function folderPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  return (await handle.queryPermission?.(READ_WRITE)) ?? "granted";
}

export async function grantedFolder(handle: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> {
  if ((await folderPermission(handle)) !== "granted") throw new FolderAccessError(handle.name);
  return handle;
}

/** PLATFORM: needs a click in a page; after a browser restart Chrome asks the user again unless they chose to always allow. */
export async function requestFolderPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return (await handle.requestPermission?.(READ_WRITE)) === "granted";
}
