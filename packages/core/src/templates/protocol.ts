// The template gallery's protocol and its untrusted-message guard: messages, payloads and channel ends, all plain JSON.
import { isRecord, isStringUpTo } from "../guards/index.js";
import type { MessageEnd } from "../libraryUi/protocol/index.js";
import { TEMPLATE_SOURCES } from "./templateCatalog.js";
import type { TemplateEntry, TemplateSourceId } from "./templateCatalog.js";
import type { PublishCheckId } from "./templateLabels.js";
import { TEMPLATE_CATEGORIES } from "./templateManifest/index.js";

/** Names one template across sources: ids are unique only within a source. */
export interface TemplateAddress {
  source: TemplateSourceId;
  id: string;
}

/** What the gallery knows of one source: still listing, listed (from the device cache when offline), or failed. */
export type SourceListing =
  | { status: "loading" }
  | { status: "ready"; entries: TemplateEntry[]; fromCache: boolean }
  | { status: "error"; message: string };

/** The project being published; `formatEngineLabel` names the engine that builds it ("pdfLaTeX"). */
export interface PublishProject {
  id: string;
  title: string;
  engineLabel: string;
}

/** The form values of the Publish screen; the host validates them again before it writes a manifest. */
export interface PublishDraft {
  name: string;
  category: string;
  license: string;
  description: string;
}

/** One check's outcome: `ok` is absent while the check has not finished; `message` explains a failure. */
export interface PublishCheckResult {
  id: PublishCheckId;
  ok?: boolean;
  message?: string;
}

export type GalleryToHost =
  | { type: "ready" }
  | { type: "refresh" }
  /** The cards that came into view; the host answers each with a `thumbnail`. */
  | { type: "thumbnails"; templates: TemplateAddress[] }
  /** The detail page opened; the host answers with an `engine`. */
  | { type: "detail"; template: TemplateAddress }
  | { type: "use"; template: TemplateAddress }
  | PublishToHost;

export type HostToGallery =
  | { type: "source"; source: TemplateSourceId; listing: SourceListing }
  /** `dataUri` is absent when the template has no thumbnail or it cannot be fetched; the card keeps its placeholder. */
  | { type: "thumbnail"; template: TemplateAddress; dataUri?: string }
  /** `problem` names what this machine lacks to build the template; absent when it can build it. */
  | { type: "engine"; template: TemplateAddress; problem?: string }
  /** "Use template" finished, was cancelled or failed; a failure also arrives as an error `notice`. */
  | { type: "use.settled"; template: TemplateAddress }
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

/** The gallery side of the channel. */
export type GalleryTransport = MessageEnd<GalleryToHost, HostToGallery>;

/** The host side of the channel. */
export type GalleryHostEnd = MessageEnd<HostToGallery, GalleryToHost>;

type Raw = Record<string, unknown>;
type FieldCheck = (value: unknown) => boolean;

const MAX_ID_LENGTH = 128;
// Far more cards than one view shows; a larger batch is a broken or hostile page, not a scroll.
const MAX_THUMBNAIL_BATCH = 200;

const isKey = (v: unknown): boolean =>
  isRecord(v)
  && (TEMPLATE_SOURCES as readonly unknown[]).includes(v["source"])
  && typeof v["id"] === "string" && v["id"].length > 0 && v["id"].length <= MAX_ID_LENGTH;
const isKeys = (v: unknown): boolean => Array.isArray(v) && v.length <= MAX_THUMBNAIL_BATCH && v.every(isKey);

// Far longer than any name or description; a larger string is a broken or hostile page.
const MAX_TEXT_LENGTH = 20_000;
const isCappedText = isStringUpTo(MAX_TEXT_LENGTH);
const hasTexts = (v: unknown, fields: string[]): boolean => isRecord(v) && fields.every((f) => isCappedText(v[f]));
const isProject = (v: unknown): boolean => hasTexts(v, ["id", "title", "engineLabel"]);
const isDraft = (v: unknown): boolean =>
  hasTexts(v, ["name", "license", "description"]) && (TEMPLATE_CATEGORIES as readonly unknown[]).includes((v as Raw)["category"]);

// The fields each message must carry, and how each one is checked.
const SHAPES: Record<GalleryToHost["type"], Record<string, FieldCheck>> = {
  "ready": {},
  "refresh": {},
  "thumbnails": { templates: isKeys },
  "detail": { template: isKey },
  "use": { template: isKey },
  "publish.start": {},
  "publish.check": { project: isProject, draft: isDraft },
  "publish.signIn": {},
  "publish.submit": { project: isProject, draft: isDraft },
};

/** @returns the message when it is one the gallery can send with valid fields, else null */
export function parseGalleryMessage(raw: unknown): GalleryToHost | null {
  if (!isRecord(raw)) return null;
  const type = raw["type"];
  if (typeof type !== "string" || !Object.hasOwn(SHAPES, type)) return null;
  const shape = SHAPES[type as GalleryToHost["type"]];
  return Object.entries(shape).every(([field, check]) => check(raw[field])) ? (raw as GalleryToHost) : null;
}
