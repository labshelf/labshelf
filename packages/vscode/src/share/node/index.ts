/** Exports the desktop share-link commands, which the vscode:// importShare URI also runs, and the device share list and relay check the sharing host reuses. */
export { registerShareLinks } from "./registerShareLinks.js";
export { readConnectedRelay, readShareRegistry, type ShareLinkHost } from "./shareLinkHost.js";
export { createVscodeShareHost } from "./createVscodeShareHost.js";
export { serveShareOn } from "./serveShareOn.js";
