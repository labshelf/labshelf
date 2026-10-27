// Validates untrusted library UI messages before a host handles them.
import { PAPER_STATUSES, type ReadingStatus } from "../../library/readingStatus/index.js";
import { isLibraryPath, isProjectPath } from "../../path/index.js";
import type { UiToHost } from "./messages.js";

type Raw = Record<string, unknown>;
type FieldCheck = (value: unknown) => boolean;

const isText = (v: unknown): v is string => typeof v === "string";
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.every(isId);
const isTexts = (v: unknown): v is string[] => Array.isArray(v) && v.every(isText);
const isStatus = (v: unknown): v is ReadingStatus => (PAPER_STATUSES as readonly unknown[]).includes(v);
const isPage = (v: unknown): boolean => v === undefined || (typeof v === "number" && Number.isInteger(v) && v > 0);
const isBool = (v: unknown): boolean => typeof v === "boolean";
const isLine = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isWorkId = (v: unknown): boolean => typeof v === "string" && /^W\d+$/.test(v);
// One entry of a paper folder: a single segment, never "." or "..", never a path.
const isEntryName = (v: unknown): boolean =>
  typeof v === "string" && v !== "" && v !== "." && v !== ".." && !v.includes("/") && !v.includes("\\");
const isDoi = (v: unknown): boolean => typeof v === "string" && /^10\.\d{4,9}\/\S+$/.test(v);

const isWebUrl = (v: unknown): boolean => typeof v === "string" && /^https?:\/\//i.test(v) && URL.canParse(v);
// The page a host opens in a browser tab: only a web address, never a script or extension URL.
const isAccess = (v: unknown): boolean =>
  !!v && typeof v === "object" && ((v as Raw)["kind"] === "login" || (v as Raw)["kind"] === "bot") && isWebUrl((v as Raw)["url"]);

// The fields each message must carry, and how each one is checked.
const SHAPES: Record<UiToHost["type"], Record<string, FieldCheck>> = {
  "ready": {},
  "navigate": { folder: isLibraryPath },
  "folder.open": { folder: isLibraryPath },
  "folder.create": { parent: isLibraryPath, name: isId },
  "folder.rename": { path: isLibraryPath, name: isId },
  "folder.delete": { path: isLibraryPath },
  "paper.open": { id: isId, page: isPage },
  "paper.openExternal": { id: isId },
  "paper.reveal": { id: isId },
  "paper.details": { id: isId },
  "paper.similar": { id: isId },
  "paper.selected": { ids: isIds },
  "paper.files": { id: isId },
  "paper.describeFile": { id: isId, name: isEntryName, description: isText },
  "paper.openFile": { id: isId, name: isEntryName },
  "paper.revealFile": { id: isId, name: isEntryName },
  "paper.copyFilePath": { id: isId, name: isEntryName },
  "paper.findPdf": { id: isId, replace: (v) => v === undefined || isBool(v) },
  "paper.attachPdf": { id: isId },
  "paper.openForPdf": { id: isId, access: isAccess },
  "paper.askAuthor": { id: isId },
  "paper.fetchMetadata": { id: isId },
  "paper.makeSearchable": { ids: isIds },
  "paper.setStatus": { ids: isIds, status: isStatus },
  "paper.setTags": { ids: isIds, add: isTexts, remove: isTexts },
  "paper.setNote": { id: isId, note: isText },
  "paper.addToSpace": { ids: (v) => isIds(v) && v.length > 0 },
  "paper.move": { ids: isIds, target: isLibraryPath },
  "paper.remove": { ids: isIds },
  "paper.add": { folder: isLibraryPath },
  "paper.addFrom": { folder: isLibraryPath, sourceId: isId, ifNoPdf: (v) => v === "ask" || v === "save" || v === "open" || v === "author", retryPdf: isBool },
  "annotations.export": { id: isId },
  "project.openSource": { project: isId, file: isProjectPath, line: isLine },
  "clipboard.write": { text: isText, label: (v) => v === undefined || isText(v) },
  "citationMap.refresh": {},
  "citationMap.import": { workId: isWorkId, doi: isDoi },
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
