// Lists, reads and changes Spaces through the library file system, notifying listeners after each change.
import { libraryLayout } from "../../library/index.js";
import type { Glossary, GlossaryReadResult, Space, SpaceReadResult } from "../model/index.js";
import * as edit from "./edits/index.js";
import type { SpaceDateDraft, TermDraft } from "./edits/index.js";
import { editGlossary, editSpace, type ReadySpace } from "./editSpace.js";
import { readAllSpaces, readGlossaryFile, readSpaceFile } from "./readSpace.js";
import { requireSpaceId } from "./requireSpaceId.js";
import { createSpaceFile, trashSpaceFolder } from "./spaceLifecycle.js";
import type { SpaceStoreOptions, StoreContext } from "./types.js";

const keep = (space: Space): { space: Space; value: undefined } => ({ space, value: undefined });
const idOf = (result: SpaceReadResult): string => (result.state === "ready" ? result.space.id : result.id);

export class SpaceStore {
  private readonly ctx: StoreContext;
  private spaces: SpaceReadResult[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(options: SpaceStoreOptions) {
    const join = (base: string, ...segments: string[]) => options.paths.join(base, ...segments);
    this.ctx = {
      fs: options.fs, logger: options.logger, layout: libraryLayout(options.root, join),
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

  /** @returns an unsubscribe function */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** @returns the new Space's id */
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

  renameSpace(id: string, name: string) { return this.change(id, "Space renamed", (s) => keep(edit.renamedSpace(s, name))); }
  setPurpose(id: string, purpose: string | undefined) { return this.change(id, "Purpose set", (s) => keep(edit.withPurpose(s, purpose))); }
  linkProject(id: string, projectId: string) { return this.change(id, "Project linked", (s) => keep(edit.withProject(s, projectId))); }
  unlinkProject(id: string, projectId: string) { return this.change(id, "Project unlinked", (s) => keep(edit.withoutProject(s, projectId))); }

  /** Papers already in the Space are left where they are. */
  addPapers(id: string, paperIds: readonly string[], folder?: string) {
    return this.change(id, "Papers added", (s) => keep(edit.withPapers(s, paperIds, folder, this.ctx.now())));
  }
  removePaper(id: string, paperId: string) { return this.change(id, "Paper removed", (s) => keep(edit.withoutPaper(s, paperId))); }
  setFocus(id: string, paperId: string, focus: boolean) { return this.change(id, "Focus set", (s) => keep(edit.withFocus(s, paperId, focus))); }
  /** A missing `folder` moves the reference to the Space root. */
  moveReference(id: string, paperId: string, folder?: string) {
    return this.change(id, "Reference moved", (s) => keep(edit.withMovedReference(s, paperId, folder)));
  }

  /** @returns the new folder's id */
  createFolder(id: string, name: string, parent?: string) { return this.change(id, "Folder created", (s) => edit.withFolder(s, name, parent)); }
  renameFolder(id: string, folderId: string, name: string) { return this.change(id, "Folder renamed", (s) => keep(edit.withRenamedFolder(s, folderId, name))); }
  /** References and child folders move to the folder's parent. */
  deleteFolder(id: string, folderId: string) { return this.change(id, "Folder deleted", (s) => keep(edit.withoutFolder(s, folderId))); }

  /** @returns the new date's id */
  addDate(id: string, draft: SpaceDateDraft) { return this.change(id, "Date added", (s) => edit.withDate(s, draft)); }
  updateDate(id: string, dateId: string, draft: SpaceDateDraft) { return this.change(id, "Date updated", (s) => keep(edit.withUpdatedDate(s, dateId, draft))); }
  removeDate(id: string, dateId: string) { return this.change(id, "Date removed", (s) => keep(edit.withoutDate(s, dateId))); }
  setDone(id: string, dateId: string, done: boolean) { return this.change(id, "Task done set", (s) => keep(edit.withDone(s, dateId, done))); }

  /** @returns the new term's id */
  addTerm(id: string, draft: TermDraft) { return this.changeGlossary(id, "Term added", (g) => edit.withTerm(g, draft)); }
  updateTerm(id: string, termId: string, draft: TermDraft) {
    return this.changeGlossary(id, "Term updated", (g) => ({ glossary: edit.withUpdatedTerm(g, termId, draft), value: undefined }));
  }
  removeTerm(id: string, termId: string) {
    return this.changeGlossary(id, "Term removed", (g) => ({ glossary: edit.withoutTerm(g, termId), value: undefined }));
  }

  private async change<T>(id: string, action: string, apply: (space: Space) => edit.Edited<T>): Promise<T> {
    await requireSpaceId(this.ctx, id, action);
    const { value, written } = await editSpace(this.ctx, id, action, apply);
    this.remember(written);
    return value;
  }

  private async changeGlossary<T>(id: string, action: string, apply: (glossary: Glossary) => { glossary: Glossary; value: T }): Promise<T> {
    await requireSpaceId(this.ctx, id, action);
    const value = await editGlossary(this.ctx, id, action, apply);
    this.notify();
    return value;
  }

  private remember(written: ReadySpace): void {
    const others = this.spaces.filter((result) => idOf(result) !== written.space.id);
    this.spaces = [...others, written].sort((a, b) => idOf(a).localeCompare(idOf(b)));
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) { listener(); }
  }
}
