/**
 * Validates what a host receives from the library UI when the UI runs in another context (a webview): every message
 * is untrusted until its type and every field check out, and folder paths must stay inside "papers".
 */
import { PAPERS_DIR } from "../../library/index.js";
import { PAPER_STATUSES, type PaperStatus } from "../../model/index.js";
import type { UiToHost } from "./messages.js";

type Raw = Record<string, unknown>;
type FieldCheck = (value: unknown) => boolean;

const isText = (v: unknown): v is string => typeof v === "string";
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.every(isId);
const isTexts = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText);
const isStatus = (v: unknown): v is PaperStatus => (PAPER_STATUSES as readonly unknown[]).includes(v);
const isPage = (v: unknown): boolean => v === undefined || (typeof v === "number" && Number.isInteger(v) && v > 0);
const isBool = (v: unknown): boolean => typeof v === "boolean";
const isLine = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** A "/"-separated path below a project folder: no leading "/", no empty, "." or ".." segment and no backslash. */
const isProjectPath = (v: unknown): boolean =>
  typeof v === "string" && !v.includes("\\") && v.split("/").every((s) => s !== "" && s !== "." && s !== "..");

/** A "/"-separated library path: "papers" or below it, with no empty, "." or ".." segment and no backslash. */
export function isLibraryPath(v: unknown): v is string {
  if (typeof v !== "string" || v.includes("\\")) return false;
  const [head, ...rest] = v.split("/");
  return head === PAPERS_DIR && rest.every((s) => s !== "" && s !== "." && s !== "..");
}

// The fields each message must carry, and how each one is checked.
const SHAPES: Record<UiToHost["type"], Record<string, FieldCheck>> = {
  "ready": {},
  "navigate": { folder: isLibraryPath },
  "folder.create": { parent: isLibraryPath, name: isId },
  "folder.rename": { path: isLibraryPath, name: isId },
  "folder.delete": { path: isLibraryPath },
  "paper.open": { id: isId, page: isPage },
  "paper.openExternal": { id: isId },
  "paper.reveal": { id: isId },
  "paper.details": { id: isId },
  "paper.similar": { id: isId },
  "paper.findPdf": { id: isId },
  "paper.attachPdf": { id: isId },
  "paper.fetchMetadata": { id: isId },
  "paper.makeSearchable": { ids: isIds },
  "paper.setStatus": { ids: isIds, status: isStatus },
  "paper.setTags": { ids: isIds, add: isTexts, remove: isTexts },
  "paper.setNote": { id: isId, note: isText },
  "paper.move": { ids: isIds, target: isLibraryPath },
  "paper.remove": { ids: isIds },
  "paper.add": { folder: isLibraryPath },
  "paper.addFrom": { folder: isLibraryPath, sourceId: isId, ifNoPdf: (v) => v === "ask" || v === "save", retryPdf: isBool },
  "annotations.export": { id: isId },
  "project.openSource": { project: isId, file: isProjectPath, line: isLine },
  "clipboard.write": { text: isText, label: (v) => v === undefined || isText(v) },
};

/** @returns the message when it is one the UI can send with valid fields, else null */
export function parseUiMessage(raw: unknown): UiToHost | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const type = (raw as Raw)["type"];
  if (typeof type !== "string" || !Object.hasOwn(SHAPES, type)) return null;
  const shape = SHAPES[type as UiToHost["type"]];
  const ok = Object.entries(shape).every(([field, check]) => check((raw as Raw)[field]));
  return ok ? (raw as UiToHost) : null;
}
