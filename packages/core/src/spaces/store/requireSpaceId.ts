// Refuses a space id that could leave its own folder of spaces/ or name a hidden entry.
import { SPACE_STORE_MODULE, type StoreContext } from "./types.js";

/** INVARIANT: a valid id is one plain, visible folder name, so it never reaches a path outside spaces/<id>/. */
export async function requireSpaceId(ctx: StoreContext, id: string, action: string): Promise<void> {
  if (id !== "" && !/[/\\]/.test(id) && !id.startsWith(".")) { return; }
  await ctx.logger.log("ERROR", SPACE_STORE_MODULE, `${action} refused: invalid space id`, { spaceId: id });
  throw new Error(`${action} refused: ${JSON.stringify(id)} is not a valid space id.`);
}
