/** Exports the desktop share-link commands, which the vscode:// importShare URI also runs, and the sharing host. */
export { registerShareLinks } from "./register.js";
export { createVscodeShareHost, serveShareOn } from "./host.js";
