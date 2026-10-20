// Declares the File System Access calls Chromium ships that TypeScript's DOM library leaves out.
interface FileSystemHandlePermissionDescriptor {
  mode: "read" | "readwrite";
}

interface FileSystemHandle {
  queryPermission?(descriptor: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface Window {
  showDirectoryPicker?(options: { id?: string; mode: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle>;
}
