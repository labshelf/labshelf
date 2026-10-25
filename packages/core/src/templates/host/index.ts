/** Exports the template gallery host: answers the page's messages and runs "Use template" through injected ports. */
export { createGalleryHost, GalleryHost } from "./galleryHost.js";
export type { GalleryHostDeps, PublishHost } from "./galleryHost.js";
export { createThumbnailUri } from "./thumbnailUri.js";
export { TEMPLATES_LOG_MODULE } from "./createTemplateProject.js";
export type { UseTemplatePorts } from "./createTemplateProject.js";
export { createPublishHost } from "./publishHost.js";
export type { GitHubSignIn, PublishableProject, PublishPorts } from "./publishPorts.js";
export { createPublishTemplateManifest, withAuthors } from "./createTemplateManifest.js";
