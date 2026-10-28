/** Exports the Node native-host installer (install, refresh, state and uninstall of a host for each browser) and the host specs it installs. */
export * from "../index.js";
export {
  installNativeHost, refreshNativeHost, checkNativeHost, uninstallNativeHost,
  type BrowserSetup, type InstallOptions, type NativeHostInstallResult, type RefreshResult,
  type BrowserHostState, type HostManifestState, type NativeHostResult, type NativeHostUninstallResult,
} from "./installNativeHost.js";
export { createSystemNativeHostEnv, runSystemRegistry } from "./nativeHostEnv.js";
export type {
  BinaryEntry, BrowserId, HostEntry, NativeHostEnv, NativeHostWarning, RegistryRunner, ScriptEntry,
} from "./nativeHostEnv.js";
