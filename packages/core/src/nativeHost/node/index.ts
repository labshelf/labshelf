/** Exports the Node native-host installer (install, refresh, state and uninstall of a host for each browser) and the host specs it installs. */
export * from "../index.js";
export { installNativeHost, type BrowserSetup, type InstallOptions, type NativeHostInstallResult } from "./installNativeHost.js";
export { refreshNativeHost, type RefreshResult } from "./refreshNativeHost.js";
export { checkNativeHost, type BrowserHostState, type HostManifestState, type NativeHostResult } from "./nativeHostState.js";
export { uninstallNativeHost, type NativeHostUninstallResult } from "./uninstallNativeHost.js";
export { runSystemRegistry } from "./runSystemRegistry.js";
export { createSystemNativeHostEnv } from "./createSystemNativeHostEnv.js";
export type {
  BinaryEntry, BrowserId, HostEntry, NativeHostEnv, NativeHostWarning, RegistryRunner, ScriptEntry,
} from "./nativeHostEnv.js";
