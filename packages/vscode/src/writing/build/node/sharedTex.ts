// Creates the per-user TeX provider that VS Code shares with the other LabShelf apps.
import * as os from "node:os";

import { createSharedTexProvider } from "@labshelf/core/node";

import type { WritingHost } from "../../session/index.js";
import { sessionLogger } from "./sessionLogger.js";

export function createVscodeTex(host: Pick<WritingHost, "current">): ReturnType<typeof createSharedTexProvider> {
  return createSharedTexProvider({
    env: process.env, platform: process.platform, homeDir: os.homedir(), logger: sessionLogger(host), fetchImpl: fetch,
  });
}
