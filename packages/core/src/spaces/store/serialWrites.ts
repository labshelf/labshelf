// Runs the writes that share a key one at a time, in call order, so no write reads a file another is about to replace.
import type { StoreContext } from "./spaceStoreOptions.js";

/** A failed write settles its slot, so the writes queued after it still run. */
export function runSerially<T>(ctx: StoreContext, key: string, write: () => Promise<T>): Promise<T> {
  const previous = ctx.writes.get(key) ?? Promise.resolve();
  const result = previous.then(write);
  const settled = result.then(() => undefined, () => undefined);
  ctx.writes.set(key, settled);
  void settled.then(() => { if (ctx.writes.get(key) === settled) { ctx.writes.delete(key); } });
  return result;
}
