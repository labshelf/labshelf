/** Exports the Node side of collaboration: a share's device-local state and the Node disk of a shared project's mirror. */
export { createNodeCollabStorage, deriveDocFileStem, type NodeCollabStorageOptions } from "./nodeCollabStorage.js";
export { createNodeMirrorFileSystem } from "./nodeMirrorFileSystem.js";
