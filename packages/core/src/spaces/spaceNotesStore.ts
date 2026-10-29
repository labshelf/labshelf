// Lists, creates, reads and edits the .qmd notes of a Space (spaces/<id>/notes/<slug>.qmd), one serial load-modify-save per Space.
// CONTRACT: documents/contracts/qmd-items.md#items
import { formatError } from "../errors/index.js";
import { stemOf } from "../path/index.js";
import type { ILogger, LibraryFileSystem } from "../ports/index.js";
import type { LibraryLayout } from "../library/index.js";
import { addItem, newItemId, parseItemFile, removeItem, serializeItemFile, setItemBody, type ItemFile, type ItemSegment } from "../qmd/item/index.js";
import { deriveNoteSlug } from "../qmd/projectNotesStore.js";

export interface StoreContext {
  readonly fs: LibraryFileSystem;
  readonly logger: ILogger;
  readonly layout: LibraryLayout<string>;
  readonly now: () => string;
  /** The tail of each key's write queue: a space id, or the spaces root for creation. */
  readonly writes: Map<string, Promise<unknown>>;
}

/** A failed write settles its slot, so the writes queued after it still run. */
export function runSerially<T>(ctx: StoreContext, key: string, write: () => Promise<T>): Promise<T> {
  const previous = ctx.writes.get(key) ?? Promise.resolve();
  const result = previous.then(write);
  const settled = result.then(() => undefined, () => undefined);
  ctx.writes.set(key, settled);
  void settled.then(() => { if (ctx.writes.get(key) === settled) { ctx.writes.delete(key); } });
  return result;
}

export interface SpaceNoteEntry { path: string; title: string; updated: string }

export interface SpaceQmdItem { id: string; body: string; author?: string; created?: string }

export interface SpaceNotesStore {
  list(spaceId: string): Promise<SpaceNoteEntry[]>;
  /** @returns the path of the new note file, relative to the Space folder. */
  create(spaceId: string, title: string): Promise<string>;
  /** @returns the items in file order; [] when the file does not exist. */
  read(spaceId: string, path: string): Promise<SpaceQmdItem[]>;
  /** @returns the item id: `id` when given, else a new one. A missing file is created with that one item. */
  addItem(spaceId: string, path: string, body: string, author?: string, id?: string): Promise<string>;
  /** Rejects, writing nothing, when no item has the id. */
  editItem(spaceId: string, path: string, id: string, body: string): Promise<void>;
  /** Rejects, writing nothing, when no item has the id. */
  removeItem(spaceId: string, path: string, id: string): Promise<void>;
}

const NOTES_DIR = "notes";
export const DISCUSSIONS_DIR = "discussions";

/** The `.qmd` file names directly inside `dir` of the Space, sorted; [] when the folder is missing. */
export async function listQmdNames(ctx: StoreContext, spaceId: string, dir: string): Promise<string[]> {
  const names = await ctx.fs.listDir(`${ctx.layout.spaceDir(spaceId)}/${dir}`);
  return names.filter((name) => name.endsWith(".qmd") && !name.startsWith(".")).sort();
}

/** INVARIANT: a valid path is `notes/<name>.qmd` or `discussions/<name>.qmd` with one plain, visible name (no slash, no leading dot), so it never reaches a file outside the folder. */
export function isQmdFilePath(path: unknown): path is string {
  if (typeof path !== "string") { return false; }
  const match = /^(?:notes|discussions)\/([^/\\]+\.qmd)$/.exec(path);
  return match !== null && !match[1]!.startsWith(".");
}

function absolutePath(ctx: StoreContext, spaceId: string, dir: string, path: string): string {
  if (spaceId === "" || /[/\\]/.test(spaceId) || spaceId.startsWith(".")) { throw new Error(`${JSON.stringify(spaceId)} is not a valid space id.`); }
  if (!path.startsWith(`${dir}/`) || !isQmdFilePath(path)) { throw new Error(`${JSON.stringify(path)} is not a ${dir} file path.`); }
  return `${ctx.layout.spaceDir(spaceId)}/${path}`;
}

/** @returns the text of the first heading line of the first item, else the file base name. */
export function titleOfItemFile(file: ItemFile, path: string): string {
  const first = file.segments.find((segment): segment is ItemSegment => segment.kind === "item");
  const match = first ? /^#[ \t]+(.+?)[ \t]*$/m.exec(first.body) : null;
  return match?.[1] ?? stemOf(path);
}

export function toQmdItems(file: ItemFile): SpaceQmdItem[] {
  return file.segments.flatMap((segment) => segment.kind === "item"
    ? [{ id: segment.id, body: segment.body, ...(segment.author === undefined ? {} : { author: segment.author }),
      ...(segment.created === undefined ? {} : { created: segment.created }) }]
    : []);
}

export async function readItemFile(ctx: StoreContext, spaceId: string, dir: string, path: string): Promise<ItemFile> {
  const absolute = absolutePath(ctx, spaceId, dir, path);
  return parseItemFile((await ctx.fs.exists(absolute)) ? await ctx.fs.readText(absolute) : "");
}

/** Re-reads the file inside the Space's write queue, applies `change` and writes the result. */
export function changeItemFile<T>(
  ctx: StoreContext, spaceId: string, dir: string, path: string, change: (file: ItemFile) => { file: ItemFile; result: T },
): Promise<T> {
  const absolute = absolutePath(ctx, spaceId, dir, path);
  return runSerially(ctx, spaceId, async () => {
    const { file, result } = change(parseItemFile((await ctx.fs.exists(absolute)) ? await ctx.fs.readText(absolute) : ""));
    await writeItemFile(ctx, spaceId, dir, absolute, file);
    return result;
  });
}

async function writeItemFile(ctx: StoreContext, spaceId: string, dir: string, absolute: string, file: ItemFile): Promise<void> {
  try {
    await ctx.fs.ensureDir(`${ctx.layout.spaceDir(spaceId)}/${dir}`);
    await ctx.fs.writeText(absolute, serializeItemFile(file));
  } catch (error) {
    await ctx.logger.log("ERROR", "spaces/qmd", "Writing a Space qmd file failed", { spaceId, path: absolute, error: formatError(error) });
    throw error;
  }
}

/** Creates `<dir>/<slug>.qmd` under a slug no file of the folder uses; `build` makes the first content from the free path. */
export function createItemFile(
  ctx: StoreContext, spaceId: string, dir: string, title: string, build: (file: ItemFile) => ItemFile,
): Promise<string> {
  absolutePath(ctx, spaceId, dir, `${dir}/x.qmd`);
  return runSerially(ctx, spaceId, async () => {
    const taken = new Set((await listQmdNames(ctx, spaceId, dir)).map(stemOf));
    const path = `${dir}/${deriveNoteSlug(title, taken)}.qmd`;
    await writeItemFile(ctx, spaceId, dir, `${ctx.layout.spaceDir(spaceId)}/${path}`, build({ segments: [] }));
    return path;
  });
}

/** Adds an item stamped with `ctx.now()`; `author` only when given. */
export function withNewItem(ctx: StoreContext, file: ItemFile, body: string, author?: string, id?: string): { file: ItemFile; result: string } {
  const itemId = id ?? newItemId();
  const next = addItem(file, { id: itemId, body, created: ctx.now(), ...(author ? { author } : {}) });
  return { file: next, result: itemId };
}

export function withEditedItem(file: ItemFile, id: string, body: string): { file: ItemFile; result: undefined } {
  return { file: setItemBody(file, id, body), result: undefined };
}

export function withRemovedItem(file: ItemFile, id: string): { file: ItemFile; result: undefined } {
  return { file: removeItem(file, id), result: undefined };
}

/** The modification time of a file as an ISO string; the epoch when the file is gone. */
export async function updatedOf(ctx: StoreContext, spaceId: string, dir: string, name: string): Promise<string> {
  const stat = await ctx.fs.stat(`${ctx.layout.spaceDir(spaceId)}/${dir}/${name}`);
  return new Date(stat?.mtimeMs ?? 0).toISOString();
}

export function createSpaceNotesStore(ctx: StoreContext): SpaceNotesStore {
  return {
    async list(spaceId) {
      const names = await listQmdNames(ctx, spaceId, NOTES_DIR);
      return Promise.all(names.map(async (name) => {
        const path = `${NOTES_DIR}/${name}`;
        return { path, title: titleOfItemFile(await readItemFile(ctx, spaceId, NOTES_DIR, path), path), updated: await updatedOf(ctx, spaceId, NOTES_DIR, name) };
      }));
    },
    create: (spaceId, title) => createItemFile(ctx, spaceId, NOTES_DIR, title, (file) => withNewItem(ctx, file, `# ${title}\n`).file),
    async read(spaceId, path) { return toQmdItems(await readItemFile(ctx, spaceId, NOTES_DIR, path)); },
    addItem: (spaceId, path, body, author, id) => changeItemFile(ctx, spaceId, NOTES_DIR, path, (file) => withNewItem(ctx, file, body, author, id)),
    editItem: (spaceId, path, id, body) => changeItemFile(ctx, spaceId, NOTES_DIR, path, (file) => withEditedItem(file, id, body)),
    removeItem: (spaceId, path, id) => changeItemFile(ctx, spaceId, NOTES_DIR, path, (file) => withRemovedItem(file, id)),
  };
}
