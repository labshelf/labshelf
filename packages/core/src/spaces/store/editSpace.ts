// Applies one edit to space.json or glossary.json as read-modify-write, re-reading just before the atomic write.
import { serializeGlossaryFile, serializeSpaceFile } from "../model/index.js";
import type { Glossary, Space, SpaceReadResult } from "../model/index.js";
import type { Edited } from "./edits/index.js";
import { readGlossaryFile, readSpaceFile } from "./readSpace.js";
import { serially } from "./serialWrites.js";
import { SPACE_STORE_MODULE, SpaceReadOnlyError, type StoreContext } from "./types.js";

export type ReadySpace = Extract<SpaceReadResult, { state: "ready" }>;

async function refuse(ctx: StoreContext, action: string, id: string, path: string, error: Error): Promise<never> {
  await ctx.logger.log("ERROR", SPACE_STORE_MODULE, `${action} failed`, { spaceId: id, path, error: error.message });
  throw error instanceof SpaceReadOnlyError ? error : new Error(`${action} failed for ${path}: ${error.message}`, { cause: error });
}

const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

async function writableSpace(ctx: StoreContext, id: string): Promise<Space> {
  const current = await readSpaceFile(ctx, id);
  if (current.state === "unreadable") { throw new Error(`the Space is unreadable: ${current.reason}`); }
  if (current.readOnlyReason !== undefined) { throw new SpaceReadOnlyError(current.path, current.readOnlyReason); }
  return current.space;
}

export function editSpace<T>(
  ctx: StoreContext, id: string, action: string, edit: (space: Space) => Edited<T>,
): Promise<{ value: T; written: ReadySpace }> {
  return serially(ctx, id, async () => {
    const path = ctx.layout.spaceFilePath(id);
    try {
      const { space, value } = edit(await writableSpace(ctx, id));
      await ctx.fs.writeText(path, serializeSpaceFile(space));
      await ctx.logger.log("INFO", SPACE_STORE_MODULE, action, { spaceId: id });
      return { value, written: { state: "ready", path, space, warnings: [] } };
    } catch (error) {
      return refuse(ctx, action, id, path, asError(error));
    }
  });
}

/** The glossary is written only while its Space may be written. */
export function editGlossary<T>(
  ctx: StoreContext, id: string, action: string, edit: (glossary: Glossary) => { glossary: Glossary; value: T },
): Promise<T> {
  return serially(ctx, id, async () => {
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
      return refuse(ctx, action, id, path, asError(error));
    }
  });
}
