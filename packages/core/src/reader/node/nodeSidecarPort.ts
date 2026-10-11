/**
 * SidecarPort over the library's .research/papers folder, for the Node apps (VS Code and the terminal).
 * Writes go through the library temp folder so a crash never leaves a half-written sidecar.
 */
import { promises as fs } from "node:fs";

import type { LibraryLayout } from "../../library/index.js";
import { writeFileAtomic } from "../../library/node/index.js";
import type { ILogger, SidecarPort } from "../../ports/index.js";

/**
 * @returns a SidecarPort reading and writing UTF-8 JSON at the layout's paperDataPath; a missing file reads as null.
 */
export function createNodeSidecarPort(
  layout: Pick<LibraryLayout<string>, "paperDataPath" | "tmpDir">,
  logger?: ILogger,
): SidecarPort {
  return {
    async read(paperId) {
      try {
        return await fs.readFile(layout.paperDataPath(paperId), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          void logger?.log("WARN", "sidecar", "Could not read the sidecar; treating it as absent", { paperId, error: String(error) });
        }
        return null;
      }
    },
    async write(paperId, text) {
      await writeFileAtomic(layout.paperDataPath(paperId), text, layout.tmpDir());
    },
  };
}
