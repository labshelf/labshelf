// Builds the managed TeX provider every LabShelf app uses: the shared folder, the system TeX and both installers.
import { join } from "node:path";

import type { ILogger } from "../../../../ports/index.js";
import type { FetchLike } from "../index.js";
import { createSystemTexProvider } from "../systemTex/index.js";

import { installTexLive } from "./installTexLive.js";
import { installTinyTex } from "./installTinyTex.js";
import { createManagedTexProvider, type ManagedTexProvider } from "./managedTexProvider.js";
import { resolveSharedToolsDir } from "./toolsDir.js";

export interface SharedTexProviderOptions {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  homeDir: string;
  logger: ILogger;
  fetchImpl: FetchLike;
}

export function createSharedTexProvider({ env, platform, homeDir, logger, fetchImpl }: SharedTexProviderOptions): ManagedTexProvider {
  const deps = { fetchImpl, logger, platform };
  return createManagedTexProvider({
    texRoot: join(resolveSharedToolsDir(env, platform, homeDir), "tex"),
    logger,
    platform,
    system: createSystemTexProvider(),
    installers: { tinytex: (run) => installTinyTex(deps, run), texlive: (run) => installTexLive(deps, run) },
  });
}
