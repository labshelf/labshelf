/**
 * Validates what a host receives from the template gallery when it runs in a webview: every message is untrusted
 * until its type and every field check out.
 */
import { isRecord, isStringUpTo } from "../../guards/index.js";
import { TEMPLATE_CATEGORIES } from "../templateManifest/index.js";
import { TEMPLATE_SOURCES } from "../templateEntry.js";
import type { GalleryToHost } from "./messages.js";

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
