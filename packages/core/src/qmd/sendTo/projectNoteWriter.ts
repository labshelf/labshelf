// The "Send to…" writer for project notes: writes a figure blob beside the note, then appends the item through ProjectNotesStore.
import type { ProjectNotesStore } from "../projectNotes/index.js";
import type { ISendTargetWriter } from "./sendTo.js";

/** Paths are relative to the project folder. */
export interface IProjectAssetWriter { write(projectId: string, path: string, bytes: Uint8Array): Promise<void> }

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

export function createProjectNoteWriter(store: ProjectNotesStore, assets: IProjectAssetWriter): ISendTargetWriter {
  return {
    async append(target, body, extra) {
      if (target.kind !== "projectNote") {
        throw new Error(`Project note writer cannot write a "${target.kind}" target`);
      }
      if (extra?.blob) {
        const dir = dirname(target.path);
        await assets.write(target.projectId, dir ? `${dir}/${extra.blob.path}` : extra.blob.path, extra.blob.bytes);
      }
      await store.addItem(target.projectId, target.path, body, extra?.author, extra?.itemId);
    },
  };
}
