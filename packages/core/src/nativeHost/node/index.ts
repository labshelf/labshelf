/** Exports the Node native-host installer and the host specs it installs. */
export * from "../index.js";
export * from "./install/index.js";
export * from "./system/index.js";
export type {
  BinaryLaunch, BrowserId, HostLaunch, NativeHostEnv, NativeHostWarning, RegistryRunner, ScriptLaunch,
} from "./nativeHostEnv.js";
