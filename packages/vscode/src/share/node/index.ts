/** Exports the desktop share-link commands, which the vscode:// importShare URI also runs, and the device share list and relay check the sharing host reuses. */
export { registerShareLinks } from "./registerShareLinks.js";
export { connectedRelay, shareRegistry, type ShareLinkHost } from "./shareLinkHost.js";
