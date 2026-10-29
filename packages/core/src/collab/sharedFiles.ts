// Maps a project folder to the files and settings a share holds: which paths, what kind, safe paths, text edits, settings and the generated bibliography.
// CONTRACT: documents/contracts/library-format.md#labshelfyaml
// CONTRACT: documents/contracts/library-format.md#generated-files
import YAML from "yaml";
import type { Doc, Map as YMap, Text } from "yjs";
import { extractArxivIdentifierFromDoi, extractArxivIdentifierFromUrl, extractDoi, normalizeArxivIdentifier } from "../import/index.js";
import { isMergeableTextFile } from "../library/conflicts/index.js";
import { parseBibEntries, readBibField, type BibEntry } from "../writing/citations/index.js";
import { deriveBuiltPdfPaths, isBuildOrToolPath, PROJECT_FILE } from "../writing/project/index.js";
import type { ShareFileEntry } from "./shareIndexDoc.js";

// The rest of .labshelf/ is device state or, for comments.qmd, written from the index doc's comments map.
export const SHARED_TOOL_FILES: readonly string[] = [".labshelf/checklist.json"];

/**
 * The paths (relative, POSIX) a share holds, in input order: what a project export holds plus labshelf.bib and
 * .labshelf/checklist.json. labshelf.yaml is left out because its shared keys travel as settings.
 */
export function deriveSharedPaths(list: readonly string[]): string[] {
  const builtPdfs = deriveBuiltPdfPaths(list);
  return list.filter((path) =>
    path !== PROJECT_FILE && !builtPdfs.has(path) && (SHARED_TOOL_FILES.includes(path) || !isBuildOrToolPath(path)));
}

const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const TOOL_FOLDER = ".labshelf";
// commentsFile.ts owns COMMENTS_PATH but imports this file, so the path is repeated here.
const COMMENTS_FILE_PATH = ".labshelf/comments.qmd";

/**
 * True for a relative POSIX path that stays inside the folder on every platform: no empty, `.` or `..` segment,
 * no backslash, colon (drive letter, NTFS stream) or NUL, no Windows device name, no trailing dot or space. The project
 * file and the tool folder are reserved in any letter case, which a case-insensitive disk folds together, except for
 * the tool files a share holds.
 */
export function isSafeSharePath(path: string): boolean {
  if (typeof path !== "string" || path === "" || /[\\:\0]/.test(path)) { return false; }
  const segments = path.split("/");
  const plain = segments.every((segment) =>
    segment !== "" && segment !== "." && segment !== ".." && !/[. ]$/.test(segment) && !WINDOWS_DEVICE.test(segment));
  if (!plain || path.toLowerCase() === PROJECT_FILE) { return false; }
  return segments[0]!.toLowerCase() !== TOOL_FOLDER || SHARED_TOOL_FILES.includes(path);
}

/** A file with a text extension and valid UTF-8 is a text doc; anything else would be corrupted by character edits. */
export function deriveSharedFileKind(path: string, bytes: Uint8Array): ShareFileEntry["kind"] {
  // comments.qmd is written from the comments map, so it is never a text doc whatever its bytes.
  if (path === COMMENTS_FILE_PATH) { return "blob"; }
  // A .qmd doc holds its items as ProseMirror fragments rather than one Y.Text.
  if (path.toLowerCase().endsWith(".qmd")) { return isValidUtf8(bytes) ? "qmd" : "blob"; }
  return isMergeableTextFile(path, bytes) ? "text" : "blob";
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true; } catch { return false; }
}

/** The Y.Text that holds a shared text file's content. */
export const readFileText = (doc: Doc): Text => doc.getText("content");

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Turns the doc's text into `next` with one delete and one insert between the common prefix and suffix, in one
 * transaction under `origin`, so concurrent edits elsewhere in the file merge instead of being replaced.
 */
export function setFileText(doc: Doc, next: string, origin: unknown): void {
  const text = readFileText(doc);
  const current = text.toString();
  if (current === next) { return; }
  const shorter = Math.min(current.length, next.length);
  let prefix = 0;
  while (prefix < shorter && current.charCodeAt(prefix) === next.charCodeAt(prefix)) { prefix += 1; }
  // TRAP: Yjs turns a half surrogate pair into U+FFFD, so an edit boundary never falls inside one.
  if (prefix > 0 && isHighSurrogate(current.charCodeAt(prefix - 1))) { prefix -= 1; }
  let suffix = 0;
  while (suffix < shorter - prefix && current.charCodeAt(current.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)) { suffix += 1; }
  if (suffix > 0 && isLowSurrogate(current.charCodeAt(current.length - suffix))) { suffix -= 1; }
  doc.transact(() => {
    const removed = current.length - prefix - suffix;
    if (removed > 0) { text.delete(prefix, removed); }
    const inserted = next.slice(prefix, next.length - suffix);
    if (inserted.length > 0) { text.insert(prefix, inserted); }
  }, origin);
}

// INVARIANT: id, folder, archived, trashed and shared are per user and never in this list.
export const SHARED_SETTING_KEYS = [
  "format", "main", "engine", "bibliography", "title", "figures", "values", "check", "target", "papers", "typst",
] as const;

/** Shared labshelf.yaml keys as plain JSON values. */
export type SharedSettings = Record<string, unknown>;

function readMapping(text: string): Record<string, unknown> {
  const doc = YAML.parseDocument(text);
  if (doc.errors.length > 0) { throw new Error(`labshelf.yaml is not valid YAML: ${doc.errors[0]!.message}`); }
  const value: unknown = doc.toJS();
  if (value === null || value === undefined) { return {}; }
  if (typeof value !== "object" || Array.isArray(value)) { throw new Error("labshelf.yaml is not a mapping"); }
  return value as Record<string, unknown>;
}

/** The shared keys present in `yamlText`; throws when the text is not a YAML mapping. */
export function parseSharedSettings(yamlText: string): SharedSettings {
  const raw = readMapping(yamlText);
  return Object.fromEntries(SHARED_SETTING_KEYS.filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]));
}

/**
 * The local labshelf.yaml with the shared keys of `shared`: a shared key absent from `shared` is removed, every other
 * key and the comments stay. A key whose value is unchanged is not rewritten, so its comments stay too.
 */
export function applySharedSettings(localYamlText: string, shared: SharedSettings): string {
  const current = readMapping(localYamlText);
  const doc = YAML.parseDocument(localYamlText);
  for (const key of SHARED_SETTING_KEYS) {
    const value = shared[key];
    if (value === undefined) { doc.delete(key); continue; }
    if (JSON.stringify(current[key]) !== JSON.stringify(value)) { doc.set(key, value); }
  }
  return doc.toString();
}

/** Sets changed keys and deletes absent ones in one transaction; an unchanged key is left alone so no update is sent. */
export function writeSettingsMap(map: YMap<unknown>, shared: SharedSettings): void {
  const write = (): void => {
    for (const key of SHARED_SETTING_KEYS) {
      const value = shared[key];
      if (value === undefined) {
        if (map.has(key)) { map.delete(key); }
      } else if (JSON.stringify(map.get(key)) !== JSON.stringify(value)) {
        map.set(key, value);
      }
    }
  };
  if (map.doc) { map.doc.transact(write); } else { write(); }
}

/**
 * Writes only the keys whose value in `shared` differs from `base`, the settings the map and the file last agreed on,
 * so a key another member changed meanwhile is left as they set it.
 */
export function writeSettingsChanges(map: YMap<unknown>, shared: SharedSettings, base: SharedSettings): void {
  const write = (): void => {
    for (const key of SHARED_SETTING_KEYS) {
      const value = shared[key];
      if (JSON.stringify(value) === JSON.stringify(base[key])) { continue; }
      if (value === undefined) { map.delete(key); } else { map.set(key, value); }
    }
  };
  if (map.doc) { map.doc.transact(write); } else { write(); }
}

/** The shared keys the map holds; keys outside the shared list (from a later version) are ignored. */
export function readSettingsMap(map: YMap<unknown>): SharedSettings {
  return Object.fromEntries(SHARED_SETTING_KEYS.filter((key) => map.has(key)).map((key) => [key, map.get(key)]));
}

/** A cite key both files use for different works; the shared entry is kept. Ids read `doi:<doi>` or `arXiv:<id>`. */
export interface BibliographyClash {
  key: string;
  sharedId: string;
  localId: string | undefined;
}

export interface MergedBibliography {
  text: string;
  clashes: BibliographyClash[];
}

interface WorkIds { doi: string | undefined; arxiv: string | undefined }

function workIds(entry: BibEntry): WorkIds {
  const doi = extractDoi(readBibField(entry, "doi"))?.toLowerCase();
  const arxiv = normalizeArxivIdentifier(readBibField(entry, "eprint"))
    ?? extractArxivIdentifierFromDoi(doi) ?? extractArxivIdentifierFromUrl(readBibField(entry, "url"));
  return { doi, arxiv: arxiv?.toLowerCase() };
}

const ARXIV_DOI = /^10\.48550\/arxiv\./i;

const idLabel = ({ doi, arxiv }: WorkIds): string | undefined =>
  doi ? `doi:${doi}` : arxiv ? `arXiv:${arxiv}` : undefined;

/**
 * Two entries under one key are the same work when their DOIs match, else when their arXiv ids match (from `eprint`,
 * an arXiv DOI or an arxiv.org url), else when the shared entry names neither, since nothing then says otherwise.
 */
function sameWork(shared: WorkIds, local: WorkIds): boolean {
  // An arXiv DOI names the preprint, so a published DOI beside it does not make another work.
  const publishedDoi = (doi: string | undefined) => (doi && !ARXIV_DOI.test(doi) ? doi : undefined);
  if (publishedDoi(shared.doi) && publishedDoi(local.doi)) { return shared.doi === local.doi; }
  if (shared.doi && shared.doi === local.doi) { return true; }
  if (shared.arxiv && shared.arxiv === local.arxiv) { return true; }
  return !shared.doi && !shared.arxiv;
}

/**
 * Adds the generated entries the shared file lacks and updates those of the same work; never removes an entry.
 * Text outside the replaced entries, comments and @string blocks included, stays byte for byte.
 */
export function mergeGeneratedBibliography(sharedText: string, generatedText: string): MergedBibliography {
  if (sharedText.trim() === "") { return { text: generatedText, clashes: [] }; }
  const shared = new Map<string, BibEntry>();
  for (const entry of parseBibEntries(sharedText)) { if (!shared.has(entry.key)) { shared.set(entry.key, entry); } }
  const replacements: { entry: BibEntry; text: string }[] = [];
  const added: string[] = [];
  const clashes: BibliographyClash[] = [];
  for (const local of parseBibEntries(generatedText)) {
    const localText = generatedText.slice(local.start, local.end);
    const current = shared.get(local.key);
    if (!current) { added.push(localText); continue; }
    const sharedIds = workIds(current);
    const localIds = workIds(local);
    if (!sameWork(sharedIds, localIds)) {
      clashes.push({ key: local.key, sharedId: idLabel(sharedIds)!, localId: idLabel(localIds) });
    } else if (sharedText.slice(current.start, current.end) !== localText) {
      replacements.push({ entry: current, text: localText });
    }
  }
  let text = sharedText;
  for (const { entry, text: replacement } of replacements.sort((a, b) => b.entry.start - a.entry.start)) {
    text = text.slice(0, entry.start) + replacement + text.slice(entry.end);
  }
  if (added.length > 0) { text = `${text.trimEnd()}\n\n${added.join("\n\n")}\n`; }
  return { text, clashes };
}
