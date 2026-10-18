/** Exports the native-host installer: install, refresh, status and uninstall of a host for each browser. */
export { installNativeHost, type BrowserSetup, type InstallOptions, type NativeHostInstallResult } from "./installNativeHost.js";
export { refreshNativeHost, type RefreshResult } from "./refreshNativeHost.js";
export { nativeHostStatus, type BrowserHostStatus, type ManifestStatus, type NativeHostStatusResult } from "./nativeHostStatus.js";
export { uninstallNativeHost, type NativeHostUninstallResult } from "./uninstallNativeHost.js";
