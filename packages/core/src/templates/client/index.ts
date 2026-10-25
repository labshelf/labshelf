// Exports the GitHub client that submits a template as a pull request.
export { publishTemplatePullRequest } from "./publishTemplatePullRequest.js";
export { GitHubError } from "./githubError.js";
export type { GitHubStep, RepoReference, PublishTemplateInput, PublishTemplateResult } from "./templatePullRequest.js";
export { startGitHubDeviceSignIn } from "./deviceAuthorization.js";
export type { GitHubDeviceAuthorization } from "./deviceAuthorization.js";
export { fetchGithubDeviceToken } from "./deviceToken.js";
export { readGitHubIdentity } from "./githubIdentity.js";
