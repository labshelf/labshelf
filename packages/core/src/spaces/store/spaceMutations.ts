// Applies edits to space.json and glossary.json: the pure edits of a parsed Space or glossary, and the read-modify-write that
// re-reads just before the atomic write.
import { toError } from "../../errors/index.js";
import { isNonEmptyString, isNonEmptyStringList, isOptional } from "../../guards/index.js";
import { isCalendarDay } from "../../time/index.js";
import {
  createEntryId, isPage, parseEntryIds, serializeGlossaryFile, serializeSpaceFile,
} from "../model/index.js";
import type { Glossary, GlossaryTerm, Space, SpaceDate, SpaceFolder, SpaceReadResult } from "../model/index.js";
import { readGlossaryFile, readSpaceFile, runSerially, SPACE_STORE_MODULE, SpaceReadOnlyError } from "./spaceStore.js";
import type { StoreContext } from "./spaceStore.js";

// Sets or clears one optional string key on an entry while keeping every other key, known or not.
export function withOptionalField<T extends object>(entry: T, key: string, value: string | undefined): T {
  const { [key]: _removed, ...rest } = entry as Record<string, unknown>;
  return (value === undefined ? rest : { ...rest, [key]: value }) as T;
}

export function withSpaceRenamed(space: Space, name: string): Space {
  const trimmed = name.trim();
  if (trimmed === "") { throw new Error("A Space needs a name."); }
  return { ...space, name: trimmed };
}

/** A blank purpose clears it. */
export function withPurpose(space: Space, purpose: string | undefined): Space {
  const trimmed = purpose?.trim();
  return withOptionalField(space, "purpose", trimmed === "" ? undefined : trimmed);
}

export function withProject(space: Space, projectId: string): Space {
  return space.projects.includes(projectId) ? space : { ...space, projects: [...space.projects, projectId] };
}

export function withProjectRemoved(space: Space, projectId: string): Space {
  return { ...space, projects: space.projects.filter((id) => id !== projectId) };
}

export interface Edited<T> { readonly space: Space; readonly value: T }

function requireFolder(space: Space, folderId: string): SpaceFolder {
  const folder = space.folders.find((candidate) => candidate.id === folderId);
  if (!folder) { throw new Error(`Folder ${folderId} is not in this Space.`); }
  return folder;
}

function requirePaper(space: Space, paperId: string): void {
  if (!space.papers.some((ref) => ref.id === paperId)) { throw new Error(`Paper ${paperId} is not in this Space.`); }
}

/** Papers already in the Space keep their place; only new ones are added. */
export function withPapers(space: Space, paperIds: readonly string[], folder: string | undefined, addedAt: string): Space {
  if (folder !== undefined) { requireFolder(space, folder); }
  const known = new Set(space.papers.map((ref) => ref.id));
  const added = [];
  for (const id of paperIds) {
    if (known.has(id)) { continue; }
    known.add(id);
    added.push({ id, ...(folder === undefined ? {} : { folder }), addedAt, focus: false, extra: {} });
  }
  return { ...space, papers: [...space.papers, ...added] };
}

export function withPaperRemoved(space: Space, paperId: string): Space {
  return { ...space, papers: space.papers.filter((ref) => ref.id !== paperId) };
}

export function withFocus(space: Space, paperId: string, focus: boolean): Space {
  requirePaper(space, paperId);
  return { ...space, papers: space.papers.map((ref) => (ref.id === paperId ? { ...ref, focus } : ref)) };
}

/** A missing `folder` moves the reference to the Space root. */
export function withMovedReference(space: Space, paperId: string, folder: string | undefined): Space {
  requirePaper(space, paperId);
  if (folder !== undefined) { requireFolder(space, folder); }
  return { ...space, papers: space.papers.map((ref) => (ref.id === paperId ? withOptionalField(ref, "folder", folder) : ref)) };
}

export function withFolder(space: Space, name: string, parent: string | undefined): Edited<string> {
  const trimmed = name.trim();
  if (trimmed === "") { throw new Error("A folder needs a name."); }
  if (parent !== undefined) { requireFolder(space, parent); }
  const id = createEntryId(new Set([...space.folders.map((folder) => folder.id), ...parseEntryIds(space.invalid.folders)]));
  const folder: SpaceFolder = { id, name: trimmed, ...(parent === undefined ? {} : { parent }), extra: {} };
  return { space: { ...space, folders: [...space.folders, folder] }, value: id };
}

export function withRenamedFolder(space: Space, folderId: string, name: string): Space {
  requireFolder(space, folderId);
  const trimmed = name.trim();
  if (trimmed === "") { throw new Error("A folder needs a name."); }
  return { ...space, folders: space.folders.map((folder) => (folder.id === folderId ? { ...folder, name: trimmed } : folder)) };
}

/** References and child folders of the deleted folder move to its parent, or to the root. */
export function withFolderRemoved(space: Space, folderId: string): Space {
  const parent = requireFolder(space, folderId).parent;
  const up = <T extends object>(entry: T, key: "parent" | "folder", from: string | undefined): T =>
    from === folderId ? withOptionalField(entry, key, parent) : entry;
  return {
    ...space,
    folders: space.folders.filter((folder) => folder.id !== folderId).map((folder) => up(folder, "parent", folder.parent)),
    papers: space.papers.map((ref) => up(ref, "folder", ref.folder)),
  };
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
/** A date as the caller describes it; the store adds the id and keeps unknown keys. */
export type SpaceDateInput = DistributiveOmit<SpaceDate, "id" | "extra">;

function checked(draft: SpaceDateInput): void {
  if (draft.title.trim() === "") { throw new Error("A date needs a title."); }
  if (!isCalendarDay(draft.date)) { throw new Error(`"${draft.date}" is not a YYYY-MM-DD date.`); }
  if (draft.kind === "read" && !isOptional(draft.paperIds, isNonEmptyStringList)) { throw new Error("paperIds is not a list of paper ids."); }
  if (draft.kind === "project" && !isOptional(draft.projectId, isNonEmptyString)) { throw new Error("projectId is not a project id."); }
}

function requireDate(space: Space, dateId: string): SpaceDate {
  const found = space.dates.find((date) => date.id === dateId);
  if (!found) { throw new Error(`Date ${dateId} is not in this Space.`); }
  return found;
}

export function withDate(space: Space, draft: SpaceDateInput): Edited<string> {
  checked(draft);
  const id = createEntryId(new Set([...space.dates.map((date) => date.id), ...parseEntryIds(space.invalid.dates)]));
  return { space: { ...space, dates: [...space.dates, { ...draft, id, extra: {} } as SpaceDate] }, value: id };
}

/** Replaces the entry's content, kind included; its id and unknown keys stay. */
export function withUpdatedDate(space: Space, dateId: string, draft: SpaceDateInput): Space {
  checked(draft);
  const old = requireDate(space, dateId);
  const next = { ...draft, id: dateId, extra: old.extra } as SpaceDate;
  return { ...space, dates: space.dates.map((date) => (date.id === dateId ? next : date)) };
}

export function withDateRemoved(space: Space, dateId: string): Space {
  return { ...space, dates: space.dates.filter((date) => date.id !== dateId) };
}

export function withDone(space: Space, dateId: string, done: boolean): Space {
  const date = requireDate(space, dateId);
  if (date.kind !== "task") { throw new Error(`Date ${dateId} is a ${date.kind}, not a task.`); }
  return { ...space, dates: space.dates.map((entry) => (entry.id === dateId ? { ...date, done } : entry)) };
}

export interface TermInput {
  readonly term: string;
  readonly symbol?: string;
  readonly definition: string;
  readonly source?: { readonly paperId: string; readonly page?: number };
}

function termFrom(draft: TermInput, id: string, old: GlossaryTerm | undefined): GlossaryTerm {
  if (draft.term.trim() === "") { throw new Error("A term needs a name."); }
  const { symbol, source } = draft;
  if (source !== undefined && !(isNonEmptyString(source.paperId) && isOptional(source.page, isPage))) {
    throw new Error("A term source needs a paper id and a whole page number of at least 1.");
  }
  return {
    id, term: draft.term.trim(), ...(symbol === undefined ? {} : { symbol }), definition: draft.definition,
    ...(source === undefined ? {} : { source: { ...source, extra: old?.source?.extra ?? {} } }),
    extra: old?.extra ?? {},
  };
}

export function withTerm(glossary: Glossary, draft: TermInput): { glossary: Glossary; value: string } {
  const id = createEntryId(new Set([...glossary.terms.map((term) => term.id), ...parseEntryIds(glossary.invalidTerms)]));
  return { glossary: { ...glossary, terms: [...glossary.terms, termFrom(draft, id, undefined)] }, value: id };
}

/** Replaces the term's content; its id and unknown keys stay. */
export function withUpdatedTerm(glossary: Glossary, termId: string, draft: TermInput): Glossary {
  const old = glossary.terms.find((term) => term.id === termId);
  if (!old) { throw new Error(`Term ${termId} is not in this glossary.`); }
  return { ...glossary, terms: glossary.terms.map((term) => (term.id === termId ? termFrom(draft, termId, old) : term)) };
}

export function withTermRemoved(glossary: Glossary, termId: string): Glossary {
  return { ...glossary, terms: glossary.terms.filter((term) => term.id !== termId) };
}

export type ReadySpace = Extract<SpaceReadResult, { state: "ready" }>;

async function refuse(ctx: StoreContext, action: string, id: string, path: string, error: Error): Promise<never> {
  await ctx.logger.log("ERROR", SPACE_STORE_MODULE, `${action} failed`, { spaceId: id, path, error: error.message });
  throw error instanceof SpaceReadOnlyError ? error : new Error(`${action} failed for ${path}: ${error.message}`, { cause: error });
}

async function writableSpace(ctx: StoreContext, id: string): Promise<Space> {
  const current = await readSpaceFile(ctx, id);
  if (current.state === "unreadable") { throw new Error(`the Space is unreadable: ${current.reason}`); }
  if (current.readOnlyReason !== undefined) { throw new SpaceReadOnlyError(current.path, current.readOnlyReason); }
  return current.space;
}

export function updateSpace<T>(
  ctx: StoreContext, id: string, action: string, edit: (space: Space) => Edited<T>,
): Promise<{ value: T; written: ReadySpace }> {
  return runSerially(ctx, id, async () => {
    const path = ctx.layout.spaceFilePath(id);
    try {
      const { space, value } = edit(await writableSpace(ctx, id));
      await ctx.fs.writeText(path, serializeSpaceFile(space));
      await ctx.logger.log("INFO", SPACE_STORE_MODULE, action, { spaceId: id });
      return { value, written: { state: "ready", path, space, warnings: [] } };
    } catch (error) {
      return refuse(ctx, action, id, path, toError(error));
    }
  });
}

/** The glossary is written only while its Space may be written. */
export function updateGlossary<T>(
  ctx: StoreContext, id: string, action: string, edit: (glossary: Glossary) => { glossary: Glossary; value: T },
): Promise<T> {
  return runSerially(ctx, id, async () => {
    const path = ctx.layout.glossaryFilePath(id);
    try {
      await writableSpace(ctx, id);
      const current = await readGlossaryFile(ctx, id);
      if (current.readOnlyReason !== undefined) { throw new SpaceReadOnlyError(path, current.readOnlyReason); }
      const { glossary, value } = edit(current.glossary);
      await ctx.fs.writeText(path, serializeGlossaryFile(glossary));
      await ctx.logger.log("INFO", SPACE_STORE_MODULE, action, { spaceId: id });
      return value;
    } catch (error) {
      return refuse(ctx, action, id, path, toError(error));
    }
  });
}
