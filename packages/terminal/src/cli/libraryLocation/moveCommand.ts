// Runs `labshelf move <path>`: moves the configured library to another folder and remembers the new location.
import type { ILogger } from "@labshelf/core";
import { moveLibrary, resolveLibraryDir } from "@labshelf/core/node";

import { resolveHomePath } from "../../platform/index.js";
import { UsageError, type Output } from "../usage.js";

export interface MoveSite {
  logger: (root: string) => ILogger;
  env: NodeJS.ProcessEnv;
  /** Writes raw text without a newline; a carriage return rewrites the progress line. */
  progress: (text: string) => void;
}

/**
 * @returns the exit code: 0 when the library moved
 * @throws UsageError when the path or the library is missing; the move's own error when it fails
 */
export async function runMove(positionals: string[], root: string | undefined, io: Output, site: MoveSite): Promise<number> {
  const raw = positionals[0];
  if (!raw) { throw new UsageError("Usage: labshelf move <path>"); }
  if (!root) { throw new UsageError("No library to move. Run `labshelf init <path>` first."); }
  const target = await resolveLibraryDir(resolveHomePath(raw));
  let reported = false;
  try {
    await moveLibrary(root, target, {
      logger: site.logger(root),
      env: site.env,
      onProgress: (copied, total) => {
        reported = true;
        site.progress(`\rCopying ${copied}/${total} files`);
      },
    });
  } finally {
    if (reported) { site.progress("\n"); }
  }
  io.out(`Moved the library to ${target}`);
  return 0;
}
