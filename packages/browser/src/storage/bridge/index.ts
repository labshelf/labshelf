// Exports the bridge client that reaches the library folder through the desktop host.
export { BridgeClosedError, BridgeConnection } from "./bridgeConnection";
export { BridgeClient, type OpenBridge } from "./connectBridge";
export { BridgeFileSystem } from "./bridgeFileSystem";
export { deriveBridgeFailure, type BridgeFailureKind } from "./bridgeFailure";
export { setBridgeLibrary } from "./setBridgeLibrary";
