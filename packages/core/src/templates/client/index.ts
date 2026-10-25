// Exports the GitHub client that submits a template as a pull request.
export { submitTemplatePullRequest } from "./publishTemplatePullRequest.js";
export { GitHubError } from "./githubError.js";
export type { GitHubStep, RepoRef, SubmitTemplateInput, SubmitTemplateResult } from "./templatePullRequest.js";
export { startGitHubDeviceSignIn } from "./deviceAuthorization.js";
export type { GitHubDeviceAuthorization } from "./deviceAuthorization.js";
export { finishGitHubDeviceSignIn } from "./deviceToken.js";
export { readGitHubIdentity } from "./githubIdentity.js";
