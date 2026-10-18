/** Watches the library folder and reports changed paths in debounced batches, without sync-tool noise. */
import { watch } from "node:fs";

import type { ILogger } from "../../ports/index.js";
import { isExternalChangeNoise } from "../../library/index.js";

// CONTRACT: documents/contracts/bridge.md#events
/** @returns a function that stops watching */
export function watchLibrary(
  root: string,
  onChanged: (paths: string[]) => void,
  logger: ILogger,
  debounceMs: number,
): () => void {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    timer = undefined;
    const paths = [...pending].sort();
    pending.clear();
    if (paths.length > 0) onChanged(paths);
  };
  // PLATFORM: recursive fs.watch needs Node 20 on Linux; macOS and Windows have it natively.
  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const relative = filename.toString().split(/[\\/]/).join("/");
    if (isExternalChangeNoise(relative)) return;
    pending.add(relative);
    timer ??= setTimeout(flush, debounceMs);
  });
  watcher.on("error", (error) => { void logger.error("bridge", error, { root, action: "watch" }); });
  return () => {
    if (timer) clearTimeout(timer);
    watcher.close();
  };
}
