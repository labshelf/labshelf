// Reports the files that change under a project folder, as POSIX paths relative to it.
import { watch } from "node:fs";
import * as path from "node:path";
import type { ILogger } from "../../../../ports/index.js";

const LOG_MODULE = "collab.mirror";

/** Starts watching; the returned function stops. A folder that cannot be watched is logged and left unwatched. */
export function watchFolder(folder: string, onChange: (relativePath: string) => void, logger: ILogger): () => void {
  try {
    // PLATFORM: recursive fs.watch needs macOS, Windows or Node 20+ on Linux.
    const watcher = watch(folder, { recursive: true }, (_event, name) => {
      if (name) { onChange(name.split(path.sep).join("/")); }
    });
    watcher.on("error", (error) => void logger.error(LOG_MODULE, error, { folder, action: "watch project folder" }));
    return () => watcher.close();
  } catch (error) {
    void logger.error(LOG_MODULE, error, { folder, action: "start watching project folder" });
    return () => undefined;
  }
}
