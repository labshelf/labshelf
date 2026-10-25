// Finds the TeX installation already on this computer and never installs anything.
import { dirname, delimiter, join } from "node:path";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";

import type { LatexEngine } from "../../../../writing/project/index.js";

import type { TexProvider } from "../../index.js";
import { findExecutable } from "../index.js";

async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** `<root>/<year>/bin/<arch>` for every installed year, the highest year first. */
export async function texLiveBinDirs(root: string): Promise<string[]> {
  const years = (await subdirs(root)).filter((name) => /^\d{4}$/.test(name)).sort().reverse();
  const dirs: string[] = [];
  for (const year of years) {
    for (const arch of (await subdirs(join(root, year, "bin"))).sort()) { dirs.push(join(root, year, "bin", arch)); }
  }
  return dirs;
}

async function tinyTexBinDirs(root: string): Promise<string[]> {
  return (await subdirs(join(root, "bin"))).sort().map((arch) => join(root, "bin", arch));
}

/** Every place a TeX install puts latexmk, probed without reading PATH. */
async function knownTexDirs(env: NodeJS.ProcessEnv): Promise<string[]> {
  const home = env.HOME ?? homedir();
  const appData = env.APPDATA;
  return [
    "/Library/TeX/texbin",
    ...(await texLiveBinDirs("/usr/local/texlive")),
    ...(await texLiveBinDirs("C:\\texlive")),
    ...(await tinyTexBinDirs(join(home, "Library", "TinyTeX"))),
    ...(await tinyTexBinDirs(join(home, ".TinyTeX"))),
    ...(appData ? await tinyTexBinDirs(join(appData, "TinyTeX")) : []),
    "/usr/bin",
  ];
}

export async function probeLatexmk(dirs: string[], env: NodeJS.ProcessEnv): Promise<string | undefined> {
  return (await findExecutable("latexmk", env))
    ?? (await findExecutable("latexmk", { PATH: dirs.join(delimiter), PATHEXT: env.PATHEXT }));
}

export interface SystemTexOptions {
  env?: NodeJS.ProcessEnv;
  /** Probed after PATH and before the known install directories. */
  extraDirs?: string[];
}

export function systemTexProvider(options: SystemTexOptions = {}): TexProvider {
  const env = options.env ?? process.env;
  return {
    // PLATFORM: a browser-launched native host has a minimal PATH, so the usual TeX install directories are probed too.
    async resolve(engine: LatexEngine) {
      const executable = await probeLatexmk([...(options.extraDirs ?? []), ...(await knownTexDirs(env))], env);
      return executable ? { engine, executable, binDir: dirname(executable) } : "missing";
    },
    installMissing: () => Promise.resolve(false),
  };
}
