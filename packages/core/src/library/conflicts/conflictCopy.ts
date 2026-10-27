// Describes sync-tool conflict copies of library files: their names, the ways to resolve them, the wording to ask about them and device-local dismissals.
import { METADATA_FILE, PAPER_NOTES_FILE } from "../layout.js";
import type { LibraryFileSystem } from "../../ports/index.js";

export type SyncTool = "syncthing" | "nextcloud" | "dropbox" | "rclone" | "app" | "unknown";

/** A paper (its paper folder or its sidecar folder), a writing project or a Space, by id. */
export type ConflictOwner = { kind: "paper"; id: string } | { kind: "project"; id: string } | { kind: "space"; id: string };

export interface ConflictCopy {
  owner: ConflictOwner;
  /** Absolute path of the file the copy conflicts with; it may be missing. */
  original: string;
  /** Absolute path of the conflict copy. */
  copy: string;
  tool: SyncTool;
  match?: "name" | "record" | "similar";
}

/** keepMine deletes the copy, keepOther replaces the original with it, keepBoth keeps it as `<name> (copy N).<ext>`. */
export type ConflictResolution = "keepMine" | "keepOther" | "keepBoth" | "mergeAutomatically" | "notAVersion";

/** The name a conflict is shown under: "Space <id>", the paper's title when known, else the owner id. */
export function formatConflictOwnerLabel(owner: ConflictOwner, paperTitle?: string): string {
  if (owner.kind === "space") return `Space ${owner.id}`;
  return (owner.kind === "paper" && paperTitle) || owner.id;
}

/** The resolutions a copy allows: keepBoth is left out for a paper's metadata.yaml and notes.qmd and for Space files, because a renamed copy of them is read by nothing. */
export function deriveConflictResolutions(conflict: ConflictCopy): ConflictResolution[] {
  if (conflict.match === "record" || conflict.match === "similar") return ["mergeAutomatically", "notAVersion"];
  const fileName = conflict.original.split(/[\\/]/).pop();
  const single = fileName === METADATA_FILE || (conflict.owner.kind === "paper" && fileName === PAPER_NOTES_FILE) || conflict.owner.kind === "space";
  return single ? ["keepMine", "keepOther"] : ["keepMine", "keepOther", "keepBoth"];
}

export interface ParsedConflictCopy {
  original: string;
  tool: SyncTool;
}

// TRAP: unconfirmed provider suffixes resemble ordinary user file names.
/** Each pattern captures the base name and, when the tool puts its marker before the extension, the extension. */
const PATTERNS: ReadonlyArray<{ tool: SyncTool; pattern: RegExp }> = [
  { tool: "app", pattern: /^(.+)\.labshelf-conflict-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}()$/ },
  // name.sync-conflict-<yyyyMMdd>-<HHmmss>-<short device id>.ext
  { tool: "syncthing", pattern: /^(.+?)\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]{7}(\.[^.]+)?$/ },
  // name (conflicted copy [user ]yyyy-MM-dd hhmmss).ext
  { tool: "nextcloud", pattern: /^(.+?) \(conflicted copy (?:\S.* )?\d{4}-\d{2}-\d{2} \d{6}\)(\.[^.]+)?$/ },
  // name (User's conflicted copy yyyy-MM-dd[ (n)]).ext
  { tool: "dropbox", pattern: /^(.+?) \(.+'s conflicted copy \d{4}-\d{2}-\d{2}(?: \(\d+\))?\)(\.[^.]+)?$/ },
  // name.ext.conflictN, name.conflictN.ext (--suffix-keep-extension), name.ext.pathN or name.ext..pathN (--conflict-loser pathname)
  { tool: "rclone", pattern: /^(.+)\.conflict\d+()$/ },
  { tool: "rclone", pattern: /^(.+?)\.conflict\d+(\.[^.]+)$/ },
  { tool: "rclone", pattern: /^(.+?)\.\.?path[12]()$/ },
];

/** @returns the original name and the tool, or null when the name is not a conflict copy. */
export function parseConflictName(name: string): ParsedConflictCopy | null {
  for (const { tool, pattern } of PATTERNS) {
    const match = pattern.exec(name);
    if (match) { return { original: `${match[1]}${match[2] ?? ""}`, tool }; }
  }
  return null;
}

// Shared wording for conflict-copy decisions.
export type ConflictAskResolution = ConflictResolution | 'mergeMyself';
export interface ConflictAskChoice { resolution: ConflictAskResolution; label: string }
const labels: Record<ConflictAskResolution, string> = {
  keepMine: 'Keep mine', keepOther: 'Keep the other', keepBoth: 'Keep both',
  mergeAutomatically: 'Merge Automatically', mergeMyself: 'Merge Myself', notAVersion: 'Not a Version',
};
export function listConflictAskChoices(copy: ConflictCopy): ConflictAskChoice[] {
  const resolutions: ConflictAskResolution[] = deriveConflictResolutions(copy);
  if (copy.match === 'record' || copy.match === 'similar') resolutions.splice(1, 0, 'mergeMyself');
  return resolutions.map(resolution => ({ resolution, label: labels[resolution] }));
}
export function describeContentConflict(copy: ConflictCopy): string {
  const name = (file: string) => file.split(/[\\/]/).at(-1) ?? file;
  return `${name(copy.copy)} appeared in ${copy.owner.id} and looks like a version of ${name(copy.original)}.`;
}

// Device-local dismissals for an exact path and content hash.
export interface ConflictDismissal { path: string; hash: string }
type DismissalReads = Pick<LibraryFileSystem, 'readText'>;
type DismissalWrites = DismissalReads & Pick<LibraryFileSystem, 'writeText'>;
const queues = new Map<string, Promise<void>>();

export async function readConflictDismissals(fs: DismissalReads, file: string): Promise<ConflictDismissal[]> {
  let text: string;
  try { text = await fs.readText(file); }
  catch (error) { if ((error as { code?: string }).code === 'ENOENT') return []; throw error; }
  const entries: unknown = JSON.parse(text);
  if (!Array.isArray(entries) || !entries.every(entry => entry && typeof entry.path === 'string' && typeof entry.hash === 'string' && /^[a-f0-9]{64}$/.test(entry.hash))) {
    throw new Error(`Invalid conflict dismissals: ${file}`);
  }
  return entries;
}

export async function writeProjectConflictDismissal(fs: DismissalWrites, file: string, path: string, hash: string): Promise<void> {
  if (!path || !/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Invalid project conflict dismissal: ${path}`);
  const operation = (queues.get(file) ?? Promise.resolve()).then(async () => {
    const entries = (await readConflictDismissals(fs, file)).filter(entry => entry.path !== path);
    await fs.writeText(file, JSON.stringify([...entries, { path, hash }]));
  });
  const settled = operation.then(() => {}, () => {});
  queues.set(file, settled);
  try { await operation; }
  finally { if (queues.get(file) === settled) queues.delete(file); }
}
