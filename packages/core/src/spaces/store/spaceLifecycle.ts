// Persists Space folder lifecycle operations.
import { serializeSpaceFile, spaceIdFromName } from "../model/index.js";
import type { Space } from "../model/index.js";
import { serially } from "./serialWrites.js";
import { SPACE_STORE_MODULE, type StoreContext } from "./spaceStoreOptions.js";

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** TRAP: another device may create the same folder between the listing and the write, so the id is re-checked last. */
async function freeSpaceId(ctx: StoreContext, name: string, taken: Set<string>): Promise<string> {
  let id = spaceIdFromName(name, taken);
  while (await ctx.fs.exists(ctx.layout.spaceDir(id))) {
    taken.add(id);
    id = spaceIdFromName(name, taken);
  }
  return id;
}

/** @returns the new Space, written under an id no folder of spaces/ uses */
export function createSpaceFile(ctx: StoreContext, name: string): Promise<Space> {
  const trimmed = name.trim();
  if (trimmed === "") { return Promise.reject(new Error("A Space needs a name.")); }
  return serially(ctx, ctx.layout.spacesRoot(), async () => {
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
      await ctx.logger.log("ERROR", SPACE_STORE_MODULE, "Space creation failed", { spaceId: id, path, error: message(error) });
      throw new Error(`Creating the Space failed for ${path}: ${message(error)}`, { cause: error });
    }
  });
}

export function trashSpaceFolder(ctx: StoreContext, id: string): Promise<void> {
  return serially(ctx, id, async () => {
    const dir = ctx.layout.spaceDir(id);
    try {
      if (!(await ctx.fs.exists(ctx.layout.spaceFilePath(id)))) { throw new Error("the Space does not exist"); }
      await ctx.fs.trash(dir);
    } catch (error) {
      await ctx.logger.log("ERROR", SPACE_STORE_MODULE, "Space deletion failed", { spaceId: id, path: dir, error: message(error) });
      throw new Error(`Deleting the Space failed for ${dir}: ${message(error)}`, { cause: error });
    }
    await ctx.logger.log("INFO", SPACE_STORE_MODULE, "Space moved to trash", { spaceId: id });
  });
}
