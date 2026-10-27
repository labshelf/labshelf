// Exports the standalone helper's host registration, its uninstall and the rule that picks which host it serves.
export { createBridgeShim } from "./bridgeAlias.js";
export { detectServedHost } from "./detectServedHost.js";
export { registerStandaloneHosts, uninstallStandaloneHosts } from "./standaloneHosts.js";
export { uninstallStandaloneHelper } from "./uninstallStandaloneHelper.js";
