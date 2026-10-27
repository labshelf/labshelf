// Declares what the browser build gets outside TypeScript: stylesheets imported as text, and the File System Access calls
// Chromium ships that TypeScript's DOM library leaves out.

/**
 * Stylesheets imported from TypeScript are text (esbuild "text" loader):
 * the content script injects the kit's tokens.css + base.css into shadow roots.
 */
declare module "*.css" {
  const text: string;
  export default text;
}

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
