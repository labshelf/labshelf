// Exports the native-messaging connection to LabShelf Helper: port, request pairing and status.
export { connectBrowserNative } from "./nativePort";
export type { HelperPortFactory, NativePort } from "./nativePort";
export { HelperClosedError, HelperConnection } from "./helperConnection";
export type { RequestBody } from "./helperConnection";
export { statusFromReady } from "./helperStatus";
export { isHostNotFound } from "./hostNotFound";
