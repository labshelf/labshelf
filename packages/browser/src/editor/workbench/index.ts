// Exports the editor page's workbench: booting it over a folder, the library under file:, and the bundled web extensions.
export { bootWorkbench } from "./bootWorkbench";
export { registerBundledExtensions } from "./bundledExtensions";
export { LIBRARY_ROOT, projectFolderUri, toWorkbenchProvider } from "./workbenchFileSystem";
