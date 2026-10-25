/** Exports the template gallery protocol: message unions and payloads, channel ends, and the guard for untrusted messages. */
export type { GalleryToHost, HostToGallery, PublishFromHost, PublishToHost } from "./messages.js";
export type { PublishCheckResult, PublishDraft, PublishProject, SourceListing, TemplateAddress } from "./payloads.js";
export type { GalleryHostEnd, GalleryTransport } from "./transport.js";
export { parseGalleryMessage } from "./messageGuards.js";
