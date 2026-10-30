// Finds a TeX installation already on this computer, never installs anything, and puts its programs first on PATH for a build.
import { promises as fs, constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, delimiter, join } from "node:path";

import type { LatexEngine } from "../../writing/project/index.js";

import type { LatexToolchain, TexProvider } from "../toolchain.js";

async function isExecutable(file: string): Promise<boolean> {
  try {
    if (!(await fs.stat(file)).isFile()) { return false; }
    await fs.access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  // PLATFORM: Windows environment variable names are case-insensitive, so PATH may be spelled Path.
  const name = Object.keys(env).find((candidate) => candidate.toUpperCase() === key.toUpperCase());
  return name === undefined ? undefined : env[name];
}

/** The first match for `name` on PATH, or undefined. */
export async function findExecutable(name: string, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const dirs = (envValue(env, "PATH") ?? "").split(delimiter).filter(Boolean);
  const extensions = process.platform === "win32"
    ? (envValue(env, "PATHEXT") ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)
    : [""];
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = join(dir, name + extension);
      if (await isExecutable(candidate)) { return candidate; }
    }
  }
  return undefined;
}

export async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** `<root>/<year>/bin/<arch>` for every installed year, the highest year first. */
export async function listTexLiveBinDirs(root: string): Promise<string[]> {
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
    ...(await listTexLiveBinDirs("/usr/local/texlive")),
    ...(await listTexLiveBinDirs("C:\\texlive")),
    ...(await tinyTexBinDirs(join(home, "Library", "TinyTeX"))),
    ...(await tinyTexBinDirs(join(home, ".TinyTeX"))),
    ...(appData ? await tinyTexBinDirs(join(appData, "TinyTeX")) : []),
    "/usr/bin",
  ];
}

export async function detectLatexmk(dirs: string[], env: NodeJS.ProcessEnv): Promise<string | undefined> {
  return (await findExecutable("latexmk", env))
    ?? (await findExecutable("latexmk", { PATH: dirs.join(delimiter), PATHEXT: env.PATHEXT }));
}

export interface SystemTexOptions {
  env?: NodeJS.ProcessEnv;
  /** Probed after PATH and before the known install directories. */
  extraDirs?: string[];
}

export function createSystemTexProvider(options: SystemTexOptions = {}): TexProvider {
  const env = options.env ?? process.env;
  return {
    // PLATFORM: a browser-launched native host has a minimal PATH, so the usual TeX install directories are probed too.
    async resolve(engine: LatexEngine) {
      const executable = await detectLatexmk([...(options.extraDirs ?? []), ...(await knownTexDirs(env))], env);
      return executable ? { engine, executable, binDir: dirname(executable) } : "missing";
    },
    installMissing: () => Promise.resolve(false),
  };
}


/** The environment that puts the directory of the toolchain's latexmk first on PATH. */
// TRAP: latexmk looks the engine up by name on PATH, so a managed or off-PATH TeX needs its bin folder there.
// The environment is copied, never assigned to process.env, because the VS Code extension host is shared.
export function withToolchainOnPath(toolchain: LatexToolchain, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const dir = toolchain.binDir ?? dirname(toolchain.executable);
  // PLATFORM: Windows environment variable names are case-insensitive, so PATH may be spelled Path.
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH");
  const rest = ((key === undefined ? undefined : env[key]) ?? "").split(delimiter).filter((entry) => entry && entry !== dir);
  return { ...env, [key ?? "PATH"]: [dir, ...rest].join(delimiter) };
}
