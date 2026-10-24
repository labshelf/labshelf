/**
 * Declares the messages the template gallery and its host exchange. The gallery filters in the page, so the host
 * only lists sources, answers per-template requests and runs "Use template".
 */
import type { TemplateSourceId } from "../templateEntry.js";
import type { PublishCheckResult, PublishDraft, PublishProject, SourceListing, TemplateKey } from "./payloads.js";

export type GalleryToHost =
  | { type: "ready" }
  | { type: "refresh" }
  /** The cards that came into view; the host answers each with a `thumbnail`. */
  | { type: "thumbnails"; templates: TemplateKey[] }
  /** The detail page opened; the host answers with an `engine`. */
  | { type: "detail"; template: TemplateKey }
  | { type: "use"; template: TemplateKey }
  | PublishToHost;

export type HostToGallery =
  | { type: "source"; source: TemplateSourceId; listing: SourceListing }
  /** `dataUri` is absent when the template has no thumbnail or it cannot be fetched; the card keeps its placeholder. */
  | { type: "thumbnail"; template: TemplateKey; dataUri?: string }
  /** `problem` names what this machine lacks to build the template; absent when it can build it. */
  | { type: "engine"; template: TemplateKey; problem?: string }
  /** "Use template" finished, was cancelled or failed; a failure also arrives as an error `notice`. */
  | { type: "use.settled"; template: TemplateKey }
  | { type: "notice"; kind: "info" | "error"; text: string }
  | PublishFromHost;

export type PublishToHost =
  /** "Publish a template" was pressed; the host picks the project and answers `publish.open`. */
  | { type: "publish.start" }
  /** Run the checks on this project; the host answers with `publish.checks`. */
  | { type: "publish.check"; project: PublishProject; draft: PublishDraft }
  | { type: "publish.signIn" }
  | { type: "publish.submit"; project: PublishProject; draft: PublishDraft };

export type PublishFromHost =
  | { type: "publish.open"; project: PublishProject; draft: PublishDraft }
  /** Checks still running have no `ok`; `running` is true until the last one finishes; `thumbnail` is the compiled first page. */
  | { type: "publish.checks"; checks: PublishCheckResult[]; running: boolean; thumbnail?: string }
  /** `login` is the signed-in GitHub account; `error` is a failed sign-in, shown inline (it also arrives as an error `notice`). */
  | { type: "publish.auth"; login?: string; error?: string }
  | { type: "publish.submitted"; url: string }
  | { type: "publish.failed"; error: string };
