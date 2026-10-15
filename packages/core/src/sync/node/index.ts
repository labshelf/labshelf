/** Exports the Node-only parts of the sync layer: the lock's file store and the loopback Google sign-in. */
export { PkceLoopbackAuth, type LoginPrompt, type PkceLoopbackOptions } from "./pkceLoopbackAuth.js";
export { NodeLockStore } from "./nodeLockStore.js";
export { isProcessAlive } from "./processAlive.js";
