/** The project's `.labshelf/outputs.json`: its sources and links, read without failing, written in canonical form with unknown keys and unreadable entries kept, and the names, ids and copy paths it holds. */
// CONTRACT: documents/contracts/library-format.md#linked-outputs
import { randomHex } from "../../encoding/index.js";
import { isRecord } from "../../guards/index.js";
import { deriveSha256Hex } from "../../hash/index.js";
import { checkRelativePath, extensionOf } from "../../path/index.js";
import { OUTPUTS_FILE_PATH } from "../project/index.js";

export { OUTPUTS_FILE_PATH };

export const OUTPUTS_FILE_VERSION = 1;

/** Where linked copies are written, relative to the project folder. */
export const OUTPUTS_FOLDER = "outputs";

export type OutputKind = "file" | "table" | "values";

export type OutputFormat = "latex" | "typst";

/** A shared source: a code repository some outputs come from. */
export interface OutputSourceRecord {
  /** The suggested command that writes the outputs, run in the source folder. */
  run?: string;
  /** The git remote of the repository the source was linked from. */
  remote?: string;
  /** Keys this version does not know, kept on rewrite. */
  extra?: Record<string, unknown>;
}

export interface OutputLink {
  id: string;
  source: string;
  /** POSIX, relative to the source folder. */
  path: string;
  kind: OutputKind;
  /** Rounding of a table's numbers; numbers are kept as written when absent. */
  decimals?: number;
  /** The dotted keys a `values` link keeps. */
  keys?: string[];
  /** The copy in the project, relative to the project folder. */
  copy: string;
  /** First 12 hex of the SHA-256 of the copy as LabShelf last wrote it. */
  hash: string;
  updated: string;
  by?: string;
  extra?: Record<string, unknown>;
}

export interface OutputsFile {
  version: number;
  sources: Record<string, OutputSourceRecord>;
  links: OutputLink[];
  /** Entries that did not parse, kept as they were on rewrite. */
  invalidSources: Record<string, unknown>;
  invalidLinks: unknown[];
  /** Top-level keys this version does not know. */
  extra: Record<string, unknown>;
}

export interface OutputsRead {
  file: OutputsFile;
  /** False for a file of another version or one whose top level does not parse: such a file is never rewritten. */
  writable: boolean;
  /** Why the file cannot be written, as a sentence. */
  problem?: string;
  /** What was skipped, for the log. */
  skipped: string[];
}

const SOURCE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const LINK_ID = /^o-[0-9a-f]{8}$/;
const KINDS: readonly OutputKind[] = ["file", "table", "values"];
const LINK_KEYS = ["id", "source", "path", "kind", "decimals", "keys", "copy", "hash", "updated", "by"];
const SOURCE_KEYS = ["run", "remote"];

export const isOutputSourceName = (name: string): boolean => SOURCE_NAME.test(name);

/** Why a source's file path cannot be linked, or undefined when it can. */
export function checkOutputPath(path: string): string | undefined {
  return checkRelativePath(path);
}

export function createEmptyOutputsFile(): OutputsFile {
  return { version: OUTPUTS_FILE_VERSION, sources: {}, links: [], invalidSources: {}, invalidLinks: [], extra: {} };
}

const extraOf = (raw: Record<string, unknown>, known: readonly string[]): Record<string, unknown> | undefined => {
  const extra = Object.fromEntries(Object.entries(raw).filter(([key]) => !known.includes(key)));
  return Object.keys(extra).length > 0 ? extra : undefined;
};

const optionalString = (value: unknown): value is string | undefined => value === undefined || typeof value === "string";

function parseSource(raw: unknown): OutputSourceRecord | undefined {
  if (!isRecord(raw) || !optionalString(raw.run) || !optionalString(raw.remote)) { return undefined; }
  const extra = extraOf(raw, SOURCE_KEYS);
  return { ...(raw.run !== undefined ? { run: raw.run } : {}), ...(raw.remote !== undefined ? { remote: raw.remote } : {}), ...(extra ? { extra } : {}) };
}

function parseLink(raw: unknown): OutputLink | undefined {
  if (!isRecord(raw)) { return undefined; }
  const { id, source, path, kind, decimals, keys, copy, hash, updated, by } = raw;
  if (typeof id !== "string" || !LINK_ID.test(id) || typeof source !== "string" || !isOutputSourceName(source)) { return undefined; }
  if (typeof path !== "string" || checkOutputPath(path) !== undefined || typeof copy !== "string" || checkRelativePath(copy) !== undefined) { return undefined; }
  if (!KINDS.includes(kind as OutputKind) || typeof hash !== "string" || typeof updated !== "string" || !optionalString(by)) { return undefined; }
  if (decimals !== undefined && !(Number.isInteger(decimals) && (decimals as number) >= 0 && (decimals as number) <= 12)) { return undefined; }
  if (keys !== undefined && !(Array.isArray(keys) && keys.every((key) => typeof key === "string"))) { return undefined; }
  if (kind === "values" && !Array.isArray(keys)) { return undefined; }
  const extra = extraOf(raw, LINK_KEYS);
  return {
    id, source, path, kind: kind as OutputKind, ...(decimals !== undefined ? { decimals: decimals as number } : {}), ...(keys !== undefined ? { keys: [...keys as string[]] } : {}),
    copy, hash, updated, ...(by !== undefined ? { by } : {}), ...(extra ? { extra } : {}),
  };
}

/** Reads the file's text; never throws. An absent file (undefined) reads as an empty, writable one. */
export function parseOutputsFile(text: string | undefined): OutputsRead {
  const file = createEmptyOutputsFile();
  if (text === undefined) { return { file, writable: true, skipped: [] }; }
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    root = undefined;
  }
  if (!isRecord(root)) { return { file, writable: false, problem: `${OUTPUTS_FILE_PATH} is not valid JSON; fix or remove it to link outputs.`, skipped: [] }; }
  const skipped: string[] = [];
  file.version = typeof root.version === "number" ? root.version : NaN;
  file.extra = extraOf(root, ["version", "sources", "links"]) ?? {};
  for (const [name, raw] of Object.entries(isRecord(root.sources) ? root.sources : {})) {
    const parsed = isOutputSourceName(name) ? parseSource(raw) : undefined;
    if (parsed) { file.sources[name] = parsed; } else { file.invalidSources[name] = raw; skipped.push(`source ${name}`); }
  }
  const ids = new Set<string>();
  for (const [index, raw] of (Array.isArray(root.links) ? root.links : []).entries()) {
    const parsed = parseLink(raw);
    if (parsed && !ids.has(parsed.id)) { ids.add(parsed.id); file.links.push(parsed); } else { file.invalidLinks.push(raw); skipped.push(`link ${index}`); }
  }
  if (file.version !== OUTPUTS_FILE_VERSION) {
    return { file, writable: false, problem: `${OUTPUTS_FILE_PATH} has version ${String(root.version)}; this LabShelf writes version ${OUTPUTS_FILE_VERSION}.`, skipped };
  }
  return { file, writable: true, skipped };
}

function sourceJson(source: OutputSourceRecord): Record<string, unknown> {
  return { ...(source.run !== undefined ? { run: source.run } : {}), ...(source.remote !== undefined ? { remote: source.remote } : {}), ...source.extra };
}

function linkJson(link: OutputLink): Record<string, unknown> {
  const { extra, ...known } = link;
  const ordered = Object.fromEntries(LINK_KEYS.flatMap((key) => (known as Record<string, unknown>)[key] === undefined ? [] : [[key, (known as Record<string, unknown>)[key]]]));
  return { ...ordered, ...extra };
}

/** Canonical JSON: two spaces, sources by name, links in file order with the unreadable ones after them, a final newline. */
export function formatOutputsFile(file: OutputsFile): string {
  const names = [...new Set([...Object.keys(file.sources), ...Object.keys(file.invalidSources)])].sort();
  const sources = Object.fromEntries(names.map((name) => [name, file.sources[name] ? sourceJson(file.sources[name]) : file.invalidSources[name]]));
  const root = { version: file.version, sources, links: [...file.links.map(linkJson), ...file.invalidLinks], ...file.extra };
  return `${JSON.stringify(root, null, 2)}\n`;
}

/** A new link id, not among `taken`. */
export function createOutputLinkId(taken: ReadonlySet<string>): string {
  for (;;) {
    const id = `o-${randomHex(4)}`;
    if (!taken.has(id)) { return id; }
  }
}

/** The hash recorded for a copy's bytes. */
export async function deriveOutputHash(bytes: Uint8Array): Promise<string> {
  return (await deriveSha256Hex(bytes)).slice(0, 12);
}

/** `outputs/<source>/<path>`, a table's extension made `.tex` or `.typ`, with `-2`, `-3`… before the extension when another link has it. */
export function deriveOutputCopyPath(source: string, path: string, kind: OutputKind, format: OutputFormat, taken: ReadonlySet<string>): string {
  const extension = kind === "table" ? (format === "latex" ? ".tex" : ".typ") : extensionOf(path) === "" ? "" : path.slice(path.lastIndexOf("."));
  const stem = `${OUTPUTS_FOLDER}/${source}/${extensionOf(path) === "" ? path : path.slice(0, path.lastIndexOf("."))}`;
  for (let n = 1; ; n++) {
    const candidate = `${stem}${n === 1 ? "" : `-${n}`}${extension}`;
    if (!taken.has(candidate)) { return candidate; }
  }
}
