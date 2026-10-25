// Exports the connection to LabShelf Helper: channels, request pairing and status.
export { createNativeChannel, openConnectionChannel } from "./helperChannel";
export type { HelperPortFactory, HelperConnectionConstructor } from "./helperChannel";
export { HelperClosedError, HelperConnection, HelperVersionError } from "./helperConnection";
export type { ConnectionHooks, FrameStep, RequestBody } from "./helperConnection";
export { deriveHelperStatus, deriveVersionErrorStatus } from "./helperProtocolVersion";
