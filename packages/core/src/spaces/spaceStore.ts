// Lists, reads and changes Spaces through the library file system, notifying listeners after each change.
import { createListeners } from "../events/index.js";
import { formatError } from "../errors/index.js";
import { createLibraryLayout, type LibraryLayout } from "../library/index.js";
import type { ILogger, LibraryFileSystem } from "../ports/index.js";
import type { PathOps } from "../path/index.js";
import {
  type Glossary,
  type GlossaryReadResult,
  type Space,
  type SpaceReadResult,
  deriveSpaceId,
  parseGlossaryFile,
  serializeSpaceFile,
} from "./space.js";
import { parseSpaceFile } from "./parseSpaceFile.js";
import * as edit from "./spaceMutations.js";
import { updateGlossary, updateSpace, type ReadySpace, type SpaceDateInput, type TermInput } from "./spaceMutations.js";


export interface SpaceStoreOptions {
  /** The library folder. */
  readonly root: string;
  readonly fs: LibraryFileSystem;
  readonly paths: Pick<PathOps, "join">;
  readonly logger: ILogger;
  /** ISO timestamp for createdAt and addedAt; the wall clock when absent. */
  readonly now?: () => string;
}

export interface StoreContext {
  readonly fs: LibraryFileSystem;
  readonly logger: ILogger;
  readonly layout: LibraryLayout<string>;
  readonly now: () => string;
  /** The tail of each key's write queue: a space id, or the spaces root for creation. */
  readonly writes: Map<string, Promise<unknown>>;
}

export const SPACE_STORE_MODULE = "spaces/store";

/** Thrown when a write is refused because the file is from a newer version or could not be understood. */
export class SpaceReadOnlyError extends Error {
  override readonly name = "SpaceReadOnlyError";
  constructor(readonly path: string, readonly reason: string) {
    super(`${path} is read-only: ${reason}`);
  }
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

export async function readSpaceFile(ctx: StoreContext, id: string): Promise<SpaceReadResult> {
  const path = ctx.layout.spaceFilePath(id);
  let result: SpaceReadResult;
  try {
    result = parseSpaceFile(await ctx.fs.readText(path), { id, path });
  } catch (error) {
    result = { state: "unreadable", id, path, reason: formatError(error) };
  }
  if (result.state === "unreadable") {
    await ctx.logger.log("WARN", SPACE_STORE_MODULE, "Space is unreadable", { path, reason: result.reason });
  } else {
    for (const warning of result.warnings) { await ctx.logger.log("WARN", SPACE_STORE_MODULE, warning, { path }); }
  }
  return result;
}

export async function readGlossaryFile(ctx: StoreContext, id: string): Promise<GlossaryReadResult> {
  const path = ctx.layout.glossaryFilePath(id);
  let result: GlossaryReadResult;
  try {
    result = parseGlossaryFile(await ctx.fs.exists(path) ? await ctx.fs.readText(path) : undefined);
  } catch (error) {
    const empty = parseGlossaryFile(undefined);
    const reason = `glossary.json could not be read: ${formatError(error)}`;
    result = { ...empty, readOnlyReason: reason };
    await ctx.logger.log("WARN", SPACE_STORE_MODULE, "Glossary is unreadable", { path, reason });
  }
  for (const warning of result.warnings) { await ctx.logger.log("WARN", SPACE_STORE_MODULE, warning, { path }); }
  return result;
}

/** Every folder of spaces/ that holds a space.json, hidden entries skipped, sorted by id. */
async function readAllSpaces(ctx: StoreContext): Promise<SpaceReadResult[]> {
  const names = (await ctx.fs.listDir(ctx.layout.spacesRoot())).filter((name) => !name.startsWith(".")).sort();
  const results: SpaceReadResult[] = [];
  for (const name of names) {
    const stat = await ctx.fs.stat(ctx.layout.spaceDir(name));
    if (!stat?.isDirectory || !(await ctx.fs.exists(ctx.layout.spaceFilePath(name)))) { continue; }
    results.push(await readSpaceFile(ctx, name));
  }
  return results;
}


/** TRAP: another device may create the same folder between the listing and the write, so the id is re-checked last. */
async function freeSpaceId(ctx: StoreContext, name: string, taken: Set<string>): Promise<string> {
  let id = deriveSpaceId(name, taken);
  while (await ctx.fs.exists(ctx.layout.spaceDir(id))) {
    taken.add(id);
    id = deriveSpaceId(name, taken);
  }
  return id;
}

/** @returns the new Space, written under an id no folder of spaces/ uses */
function createSpaceFile(ctx: StoreContext, name: string): Promise<Space> {
  const trimmed = name.trim();
  if (trimmed === "") { return Promise.reject(new Error("A Space needs a name.")); }
  return runSerially(ctx, ctx.layout.spacesRoot(), async () => {
    const taken = new Set(await ctx.fs.listDir(ctx.layout.spacesRoot()));
    const id = await freeSpaceId(ctx, trimmed, taken);
    try {
      await ctx.fs.ensureDir(ctx.layout.spaceDir(id));
      const space: Space = { id, name: trimmed, createdAt: ctx.now(), folders: [], papers: [], projects: [], dates: [],
        invalid: { folders: [], papers: [], projects: [], dates: [] }, extra: {},
      };
      await ctx.fs.writeText(ctx.layout.spaceFilePath(id), serializeSpaceFile(space));
      await ctx.logger.log("INFO", SPACE_STORE_MODULE, "Space created", { spaceId: id });
      return space;
    } catch (error) {
      const path = ctx.layout.spaceFilePath(id);
      await ctx.logger.log("ERROR", SPACE_STORE_MODULE, "Space creation failed", { spaceId: id, path, error: formatError(error) });
      throw new Error(`Creating the Space failed for ${path}: ${formatError(error)}`, { cause: error });
    }
  });
}

function trashSpaceFolder(ctx: StoreContext, id: string): Promise<void> {
  return runSerially(ctx, id, async () => {
    const dir = ctx.layout.spaceDir(id);
    try {
      if (!(await ctx.fs.exists(ctx.layout.spaceFilePath(id)))) { throw new Error("the Space does not exist"); }
      await ctx.fs.trash(dir);
    } catch (error) {
      await ctx.logger.log("ERROR", SPACE_STORE_MODULE, "Space deletion failed", { spaceId: id, path: dir, error: formatError(error) });
      throw new Error(`Deleting the Space failed for ${dir}: ${formatError(error)}`, { cause: error });
    }
    await ctx.logger.log("INFO", SPACE_STORE_MODULE, "Space moved to trash", { spaceId: id });
  });
}

/** INVARIANT: a valid id is one plain, visible folder name, so it never reaches a path outside spaces/<id>/. */
async function requireSpaceId(ctx: StoreContext, id: string, action: string): Promise<void> {
  if (id !== "" && !/[/\\]/.test(id) && !id.startsWith(".")) { return; }
  await ctx.logger.log("ERROR", SPACE_STORE_MODULE, `${action} refused: invalid space id`, { spaceId: id });
  throw new Error(`${action} refused: ${JSON.stringify(id)} is not a valid space id.`);
}

const keep = (space: Space): { space: Space; value: undefined } => ({ space, value: undefined });
const idOf = (result: SpaceReadResult): string => (result.state === "ready" ? result.space.id : result.id);

export class SpaceStore {
  private readonly ctx: StoreContext;
  private spaces: SpaceReadResult[] = [];
  private readonly listeners = createListeners();

  constructor(options: SpaceStoreOptions) {
    const join = (base: string, ...segments: string[]) => options.paths.join(base, ...segments);
    this.ctx = {
      fs: options.fs, logger: options.logger, layout: createLibraryLayout(options.root, join),
      now: options.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, "Z")), writes: new Map(),
    };
  }

  /** The Spaces of the last reload or mutation, sorted by id. */
  list(): readonly SpaceReadResult[] { return this.spaces; }

  async read(id: string): Promise<SpaceReadResult> {
    await requireSpaceId(this.ctx, id, "Space read");
    return readSpaceFile(this.ctx, id);
  }

  async readGlossary(id: string): Promise<GlossaryReadResult> {
    await requireSpaceId(this.ctx, id, "Glossary read");
    return readGlossaryFile(this.ctx, id);
  }

  async reload(): Promise<readonly SpaceReadResult[]> {
    this.spaces = await readAllSpaces(this.ctx);
    this.notify();
    return this.spaces;
  }

  onChange(listener: () => void): () => void {
    return this.listeners.add(listener);
  }

  async createSpace(name: string): Promise<string> {
    const space = await createSpaceFile(this.ctx, name);
    this.remember({ state: "ready", path: this.ctx.layout.spaceFilePath(space.id), space, warnings: [] });
    return space.id;
  }

  async deleteSpace(id: string): Promise<void> {
    await requireSpaceId(this.ctx, id, "Space deletion");
    await trashSpaceFolder(this.ctx, id);
    this.spaces = this.spaces.filter((result) => idOf(result) !== id);
    this.notify();
  }

  renameSpace(id: string, name: string) { return this.change(id, "Space renamed", (s) => keep(edit.withSpaceRenamed(s, name))); }
  setPurpose(id: string, purpose: string | undefined) { return this.change(id, "Purpose set", (s) => keep(edit.withPurpose(s, purpose))); }
  linkProject(id: string, projectId: string) { return this.change(id, "Project linked", (s) => keep(edit.withProject(s, projectId))); }
  unlinkProject(id: string, projectId: string) { return this.change(id, "Project unlinked", (s) => keep(edit.withProjectRemoved(s, projectId))); }

  /** Papers already in the Space are left where they are. */
  addPapers(id: string, paperIds: readonly string[], folder?: string) {
    return this.change(id, "Papers added", (s) => keep(edit.withPapers(s, paperIds, folder, this.ctx.now())));
  }
  removePaper(id: string, paperId: string) { return this.change(id, "Paper removed", (s) => keep(edit.withPaperRemoved(s, paperId))); }
  setFocus(id: string, paperId: string, focus: boolean) { return this.change(id, "Focus set", (s) => keep(edit.withFocus(s, paperId, focus))); }
  /** A missing `folder` moves the reference to the Space root. */
  moveReference(id: string, paperId: string, folder?: string) {
    return this.change(id, "Reference moved", (s) => keep(edit.withMovedReference(s, paperId, folder)));
  }

  createFolder(id: string, name: string, parent?: string) { return this.change(id, "Folder created", (s) => edit.withFolder(s, name, parent)); }
  renameFolder(id: string, folderId: string, name: string) { return this.change(id, "Folder renamed", (s) => keep(edit.withRenamedFolder(s, folderId, name))); }
  /** References and child folders move to the folder's parent. */
  deleteFolder(id: string, folderId: string) { return this.change(id, "Folder deleted", (s) => keep(edit.withFolderRemoved(s, folderId))); }

  addDate(id: string, draft: SpaceDateInput) { return this.change(id, "Date added", (s) => edit.withDate(s, draft)); }
  updateDate(id: string, dateId: string, draft: SpaceDateInput) { return this.change(id, "Date updated", (s) => keep(edit.withUpdatedDate(s, dateId, draft))); }
  removeDate(id: string, dateId: string) { return this.change(id, "Date removed", (s) => keep(edit.withDateRemoved(s, dateId))); }
  setDone(id: string, dateId: string, done: boolean) { return this.change(id, "Task done set", (s) => keep(edit.withDone(s, dateId, done))); }

  addTerm(id: string, draft: TermInput) { return this.changeGlossary(id, "Term added", (g) => edit.withTerm(g, draft)); }
  updateTerm(id: string, termId: string, draft: TermInput) {
    return this.changeGlossary(id, "Term updated", (g) => ({ glossary: edit.withUpdatedTerm(g, termId, draft), value: undefined }));
  }
  removeTerm(id: string, termId: string) {
    return this.changeGlossary(id, "Term removed", (g) => ({ glossary: edit.withTermRemoved(g, termId), value: undefined }));
  }

  private async change<T>(id: string, action: string, apply: (space: Space) => edit.Edited<T>): Promise<T> {
    await requireSpaceId(this.ctx, id, action);
    const { value, written } = await updateSpace(this.ctx, id, action, apply);
    this.remember(written);
    return value;
  }

  private async changeGlossary<T>(id: string, action: string, apply: (glossary: Glossary) => { glossary: Glossary; value: T }): Promise<T> {
    await requireSpaceId(this.ctx, id, action);
    const value = await updateGlossary(this.ctx, id, action, apply);
    this.notify();
    return value;
  }

  private remember(written: ReadySpace): void {
    const others = this.spaces.filter((result) => idOf(result) !== written.space.id);
    this.spaces = [...others, written].sort((a, b) => idOf(a).localeCompare(idOf(b)));
    this.notify();
  }

  private notify(): void {
    this.listeners.emit();
  }
}
