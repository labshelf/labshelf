// Exports the connection to LabShelf Helper: channels, request pairing and status.
export { nativeChannel, openSocketChannel } from "./helperChannel";
export type { HelperChannel, HelperPortFactory, HelperWebSocketConstructor } from "./helperChannel";
export { HelperClosedError, HelperConnection } from "./helperConnection";
export type { ConnectionHooks, FrameStep, RequestBody } from "./helperConnection";
export { statusFromReady } from "./helperStatus";
