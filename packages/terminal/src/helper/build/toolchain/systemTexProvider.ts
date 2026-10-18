// Finds the TeX installation already on this computer and never installs anything.
import type { HelperEngine } from "@labshelf/core/helper";

import { probeLatexmk } from "./probeLatexmk.js";
import { knownTexDirs } from "./texDirs.js";
import type { TexProvider } from "./texProvider.js";

export interface SystemTexOptions {
  env?: NodeJS.ProcessEnv;
  /** Probed after PATH and before the known install directories. */
  extraDirs?: string[];
}

export function systemTexProvider(options: SystemTexOptions = {}): TexProvider {
  const env = options.env ?? process.env;
  return {
    // PLATFORM: a browser-launched native host has a minimal PATH, so the usual TeX install directories are probed too.
    async resolve(engine: HelperEngine) {
      const executable = await probeLatexmk([...(options.extraDirs ?? []), ...(await knownTexDirs(env))], env);
      return executable ? { engine, executable } : "missing";
    },
    installMissing: () => Promise.resolve(false),
  };
}
