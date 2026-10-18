// Exports the standalone helper's host registration and the rule that picks which host it serves.
export { bridgeShim } from "./bridgeAlias.js";
export { servedHost, type ServedHost } from "./servedHost.js";
export { registerStandaloneHosts, unregisterStandaloneHosts } from "./standaloneHosts.js";
