/** Exports the files tray's public API. */
export { paintTray, replaceTrayRows } from "./drawTray.js";
export { buildFailedRow, buildLoadingRow, buildTrayRow } from "./trayRows.js";
export type { TrayEntry } from "./fileFacts.js";
export { wireFilesRequest } from "./attachFilesRequest.js";
