// Changes the folders of a Space and the paper references inside them.
import { newShortId } from "../../model/index.js";
import { rawEntryIds } from "../../model/json/index.js";
import type { Space, SpaceFolder } from "../../model/index.js";
import { withOptionalField } from "./optionalField.js";

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
  const id = newShortId(new Set([...space.folders.map((folder) => folder.id), ...rawEntryIds(space.invalid.folders)]));
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
