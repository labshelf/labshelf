// Exports GitHub device authorization for clients that cannot hold a client secret.
export { startGitHubDeviceSignIn } from "./deviceAuthorization.js";
export type { GitHubDeviceAuthorization } from "./deviceAuthorization.js";
export { finishGitHubDeviceSignIn } from "./deviceToken.js";
export { readGitHubIdentity } from "./githubIdentity.js";
