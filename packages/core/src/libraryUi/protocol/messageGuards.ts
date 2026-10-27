// Validates untrusted library UI messages before a host handles them.
import { isBoolean, isCount, isNonEmptyString, isNonEmptyStringList, isString, isStringArray } from "../../guards/index.js";
import { PAPER_STATUSES, type ReadingStatus } from "../../library/readingStatus/index.js";
import { isLibraryPath, isProjectPath } from "../../path/index.js";
import type { UiToHost } from "./messages.js";

type Raw = Record<string, unknown>;
type FieldCheck = (value: unknown) => boolean;

const isStatus = (v: unknown): v is ReadingStatus => (PAPER_STATUSES as readonly unknown[]).includes(v);
const isPage = (v: unknown): boolean => v === undefined || (typeof v === "number" && Number.isInteger(v) && v > 0);
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
  "folder.create": { parent: isLibraryPath, name: isNonEmptyString },
  "folder.rename": { path: isLibraryPath, name: isNonEmptyString },
  "folder.delete": { path: isLibraryPath },
  "paper.open": { id: isNonEmptyString, page: isPage },
  "paper.openExternal": { id: isNonEmptyString },
  "paper.reveal": { id: isNonEmptyString },
  "paper.details": { id: isNonEmptyString },
  "paper.similar": { id: isNonEmptyString },
  "paper.selected": { ids: isNonEmptyStringList },
  "paper.files": { id: isNonEmptyString },
  "paper.describeFile": { id: isNonEmptyString, name: isEntryName, description: isString },
  "paper.openFile": { id: isNonEmptyString, name: isEntryName },
  "paper.revealFile": { id: isNonEmptyString, name: isEntryName },
  "paper.copyFilePath": { id: isNonEmptyString, name: isEntryName },
  "paper.findPdf": { id: isNonEmptyString, replace: (v) => v === undefined || isBoolean(v) },
  "paper.attachPdf": { id: isNonEmptyString },
  "paper.openForPdf": { id: isNonEmptyString, access: isAccess },
  "paper.askAuthor": { id: isNonEmptyString },
  "paper.fetchMetadata": { id: isNonEmptyString },
  "paper.makeSearchable": { ids: isNonEmptyStringList },
  "paper.setStatus": { ids: isNonEmptyStringList, status: isStatus },
  "paper.setTags": { ids: isNonEmptyStringList, add: isStringArray, remove: isStringArray },
  "paper.setNote": { id: isNonEmptyString, note: isString },
  "paper.addToSpace": { ids: (v) => isNonEmptyStringList(v) && v.length > 0 },
  "paper.move": { ids: isNonEmptyStringList, target: isLibraryPath },
  "paper.remove": { ids: isNonEmptyStringList },
  "paper.add": { folder: isLibraryPath },
  "paper.addFrom": { folder: isLibraryPath, sourceId: isNonEmptyString, ifNoPdf: (v) => v === "ask" || v === "save" || v === "open" || v === "author", retryPdf: isBoolean },
  "annotations.export": { id: isNonEmptyString },
  "project.openSource": { project: isNonEmptyString, file: isProjectPath, line: isCount },
  "clipboard.write": { text: isString, label: (v) => v === undefined || isString(v) },
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
