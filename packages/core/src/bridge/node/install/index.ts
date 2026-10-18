/** Exports the bridge installer: install, status and uninstall of the Native Messaging host for each browser. */
export { bridgeStatus, type BridgeStatusResult, type BrowserBridgeStatus } from "./bridgeStatus.js";
export { installBridge, type BridgeInstallResult, type BrowserSetup } from "./installBridge.js";
export { uninstallBridge, type BridgeUninstallResult } from "./uninstallBridge.js";
export type { BridgeEnv, BridgeLaunch, BridgeWarning, BrowserId, RegistryRunner } from "./installEnv.js";
