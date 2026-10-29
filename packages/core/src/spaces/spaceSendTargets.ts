// Send to writers for Space notes and Space threads: append the sent item through the 10.1 stores, writing a figure blob first.
import type { ISendTargetWriter, SendExtra, SendTarget } from "../qmd/sendTo.js";
import type { SpaceDiscussionsStore } from "./spaceDiscussionsStore.js";
import type { SpaceNotesStore } from "./spaceNotesStore.js";

/** Writes a binary file at `path`, relative to the Space folder. */
export interface SpaceAssetWriter { write(spaceId: string, path: string, bytes: Uint8Array): Promise<void> }

function dirnameOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** Writes the blob next to the target file; a rejected write rejects before anything is appended. */
async function writeBlob(assets: SpaceAssetWriter, spaceId: string, targetPath: string, blob: SendExtra["blob"]): Promise<void> {
  if (!blob) return;
  const dir = dirnameOf(targetPath);
  await assets.write(spaceId, dir === "" ? blob.path : `${dir}/${blob.path}`, blob.bytes);
}

function spaceTarget(target: SendTarget, kind: "spaceNote" | "discussion"): { spaceId: string; path: string } {
  if (target.kind !== kind) throw new Error(`Expected a "${kind}" send target, got "${target.kind}"`);
  return target;
}

export function createSpaceSendWriters(
  notes: SpaceNotesStore, discussions: SpaceDiscussionsStore, assets: SpaceAssetWriter,
): { spaceNote: ISendTargetWriter; discussion: ISendTargetWriter } {
  return {
    spaceNote: {
      async append(target, body, extra) {
        const { spaceId, path } = spaceTarget(target, "spaceNote");
        await writeBlob(assets, spaceId, path, extra?.blob);
        await notes.addItem(spaceId, path, body, extra?.author, extra?.itemId);
      },
    },
    discussion: {
      async append(target, body, extra) {
        const { spaceId, path } = spaceTarget(target, "discussion");
        await writeBlob(assets, spaceId, path, extra?.blob);
        await discussions.addMessage(spaceId, path, body, extra?.author, extra?.itemId);
      },
    },
  };
}
