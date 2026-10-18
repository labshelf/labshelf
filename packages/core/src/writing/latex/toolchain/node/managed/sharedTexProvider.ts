// Builds the managed TeX provider every LabShelf app uses: the shared folder, the system TeX and both installers.
import { join } from "node:path";

import type { ILogger } from "../../../../../ports/index.js";
import type { FetchLike } from "../index.js";
import { systemTexProvider } from "../system/index.js";

import { installTexLive, installTinyTex } from "./install/index.js";
import { createManagedTexProvider, type ManagedTexProvider } from "./managedTexProvider.js";
import { sharedToolsRoot } from "./sharedToolsRoot.js";

export interface SharedTexProviderOptions {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  homeDir: string;
  logger: ILogger;
  fetchImpl: FetchLike;
}

export function createSharedTexProvider({ env, platform, homeDir, logger, fetchImpl }: SharedTexProviderOptions): ManagedTexProvider {
  const deps = { fetchImpl, logger };
  return createManagedTexProvider({
    texRoot: join(sharedToolsRoot(env, platform, homeDir), "tex"),
    logger,
    system: systemTexProvider(),
    installers: { tinytex: (run) => installTinyTex(deps, run), texlive: (run) => installTexLive(deps, run) },
  });
}
