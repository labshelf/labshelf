/**
 * Declares the messages the template gallery and its host exchange. The gallery filters in the page, so the host
 * only lists sources, answers per-template requests and runs "Use template".
 */
import type { TemplateSourceId } from "../templateEntry.js";
import type { SourceListing, TemplateKey } from "./payloads.js";

export type GalleryToHost =
  | { type: "ready" }
  | { type: "refresh" }
  /** The cards that came into view; the host answers each with a `thumbnail`. */
  | { type: "thumbnails"; templates: TemplateKey[] }
  /** The detail page opened; the host answers with an `engine`. */
  | { type: "detail"; template: TemplateKey }
  | { type: "use"; template: TemplateKey };

export type HostToGallery =
  | { type: "source"; source: TemplateSourceId; listing: SourceListing }
  /** `dataUri` is absent when the template has no thumbnail or it cannot be fetched; the card keeps its placeholder. */
  | { type: "thumbnail"; template: TemplateKey; dataUri?: string }
  /** `problem` names what this machine lacks to build the template; absent when it can build it. */
  | { type: "engine"; template: TemplateKey; problem?: string }
  /** "Use template" finished, was cancelled or failed; a failure also arrives as an error `notice`. */
  | { type: "use.settled"; template: TemplateKey }
  | { type: "notice"; kind: "info" | "error"; text: string };
