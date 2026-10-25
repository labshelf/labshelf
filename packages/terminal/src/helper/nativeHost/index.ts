// Exports the standalone helper's host registration, its uninstall and the rule that picks which host it serves.
export { bridgeShim } from "./bridgeAlias.js";
export { servedHost, type ServedHost } from "./servedHost.js";
export { registerStandaloneHosts, unregisterStandaloneHosts } from "./standaloneHosts.js";
export { uninstallStandaloneHelper } from "./uninstallStandaloneHelper.js";
