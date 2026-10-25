/** Exports the Node native-host installer (install, refresh, state and uninstall of a host for each browser) and the host specs it installs. */
export * from "../index.js";
export { installNativeHost, type BrowserSetup, type InstallOptions, type NativeHostInstallResult } from "./installNativeHost.js";
export { refreshNativeHost, type RefreshResult } from "./refreshNativeHost.js";
export { nativeHostStatus, type BrowserHostStatus, type ManifestStatus, type NativeHostStatusResult } from "./nativeHostState.js";
export { uninstallNativeHost, type NativeHostUninstallResult } from "./uninstallNativeHost.js";
export { systemRegistry } from "./systemRegistry.js";
export { systemNativeHostEnv } from "./systemNativeHostEnv.js";
export type {
  BinaryLaunch, BrowserId, HostLaunch, NativeHostEnv, NativeHostWarning, RegistryRunner, ScriptLaunch,
} from "./nativeHostEnv.js";
