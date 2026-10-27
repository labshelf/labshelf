/** Exports the template gallery host and its protocol: answers the page's messages, runs "Use template" and the Publish screen through injected ports, and carries the GitHub client that publishes a template. */
export { createGalleryHost, createPublishTemplateManifest, createThumbnailUri, GalleryHost, TEMPLATES_LOG_MODULE, withAuthors } from "./galleryHost.js";
export type { GalleryHostDeps, PublishHost, UseTemplatePorts } from "./galleryHost.js";
export { createPublishHost } from "./publishHost.js";
export type { GitHubSignIn, PublishableProject, PublishPorts } from "./publishHost.js";
export { fetchGithubDeviceToken, GitHubError, publishTemplatePullRequest, readGitHubIdentity, startGitHubDeviceSignIn } from "./githubClient.js";
export type { GitHubDeviceAuthorization, GitHubStep, PublishTemplateInput, PublishTemplateResult, RepoReference } from "./githubClient.js";
export { parseGalleryMessage } from "./protocol.js";
export type { GalleryHostEnd, GalleryToHost, GalleryTransport, HostToGallery, PublishCheckResult, PublishDraft, PublishFromHost, PublishProject, PublishToHost, SourceListing, TemplateAddress } from "./protocol.js";
