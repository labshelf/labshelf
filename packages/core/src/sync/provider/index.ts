// Exports the public remote-provider contract and path resolver.
export type {
  RemoteNamespace,
  RemoteFile,
  RemoteProvider,
} from "./remoteProvider.js";
export type { IAuthProvider } from "./authProvider.js";
export { RemotePathResolver, splitPath } from "./remotePathResolver.js";
