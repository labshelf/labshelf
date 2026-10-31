// Finds wolframscript or Rscript (an explicit override, then PATH, then the usual install locations of each OS), python (an override, then python3 or python on PATH) and the WolframKernel beside wolframscript.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { envValue, findExecutable, subdirs } from "../../../latex/node/index.js";

type LocatedTool = "wolframscript" | "Rscript" | "python";

interface LocateToolOptions {
  override?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => Promise<boolean>;
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

const newestFirst = (names: string[]): string[] => [...names].sort().reverse();

/** Every directory the tool may live in on Windows: Wolfram products (with or without a version folder) or R versions, newest first. */
async function windowsDirs(tool: "wolframscript" | "Rscript", env: NodeJS.ProcessEnv): Promise<string[]> {
  const programFiles = envValue(env, "ProgramFiles") ?? "C:\\Program Files";
  if (tool === "Rscript") {
    const root = path.join(programFiles, "R");
    return newestFirst((await subdirs(root)).filter((name) => name.startsWith("R-"))).map((name) => path.join(root, name, "bin"));
  }
  const root = path.join(programFiles, "Wolfram Research");
  const dirs: string[] = [];
  for (const product of newestFirst(await subdirs(root))) {
    const productDir = path.join(root, product);
    dirs.push(productDir);
    for (const version of newestFirst(await subdirs(productDir))) { dirs.push(path.join(productDir, version)); }
  }
  return dirs;
}

function macDirs(tool: "wolframscript" | "Rscript"): string[] {
  const common = ["/usr/local/bin", "/opt/homebrew/bin"];
  if (tool === "Rscript") { return ["/Library/Frameworks/R.framework/Resources/bin", ...common]; }
  const apps = ["Wolfram Engine", "Mathematica", "Wolfram"].map((app) => `/Applications/${app}.app/Contents/MacOS`);
  return [...apps, ...common];
}

const MAC_STUB_PYTHONS = ["/usr/bin/python3", "/usr/bin/python"];
const MAC_REAL_PYTHONS = ["/Library/Developer/CommandLineTools/usr/bin/python3", "/Applications/Xcode.app/Contents/Developer/usr/bin/python3"];

/** Whether running `candidate` starts Python: the Microsoft Store alias on Windows and the macOS shim without the Command Line Tools only open an installer. */
async function isRealPython(candidate: string, platform: NodeJS.Platform, exists: (path: string) => Promise<boolean>): Promise<boolean> {
  if (platform === "win32") { return !candidate.toLowerCase().includes("\\windowsapps\\"); }
  if (platform === "darwin" && MAC_STUB_PYTHONS.includes(candidate)) {
    for (const real of MAC_REAL_PYTHONS) { if (await exists(real)) { return true; } }
    return false;
  }
  return true;
}

/** The first python3, else python, in a PATH folder that is not an installer stub: a stub's folder is passed over for the next one. */
async function locatePython(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, exists: (path: string) => Promise<boolean>): Promise<string | undefined> {
  const dirs = (envValue(env, "PATH") ?? "").split(path.delimiter).filter(Boolean);
  const rest = Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== "PATH"));
  for (const name of ["python3", "python"]) {
    for (const dir of dirs) {
      const found = await findExecutable(name, { ...rest, PATH: dir });
      if (found !== undefined && await isRealPython(found, platform, exists)) { return found; }
    }
  }
  return undefined;
}

/** The path of `tool`, or undefined when it is nowhere: override first, then PATH, then (not for python, whose fallback is the managed Python) the install locations of `platform`. */
export async function locateTool(tool: LocatedTool, options: LocateToolOptions = {}): Promise<string | undefined> {
  const { override, platform = process.platform, env = process.env, exists = isFile } = options;
  if (override && await exists(override)) { return override; }
  if (tool === "python") { return locatePython(platform, env, exists); }
  const onPath = await findExecutable(tool, env);
  if (onPath !== undefined) { return onPath; }
  const file = platform === "win32" ? `${tool}.exe` : tool;
  const dirs = platform === "win32" ? await windowsDirs(tool, env)
    : platform === "darwin" ? macDirs(tool)
      : ["/usr/bin", "/usr/local/bin"];
  for (const dir of dirs) {
    const candidate = path.join(dir, file);
    if (await exists(candidate)) { return candidate; }
  }
  return undefined;
}

/** The WolframKernel installed beside wolframscript. wolframscript reads stdin to its end before it runs a script, so a persistent driver cannot run under `wolframscript -file`. */
export async function kernelBeside(wolframscript: string): Promise<string | undefined> {
  const dir = path.dirname(await fs.realpath(wolframscript).catch(() => wolframscript));
  for (const name of ["WolframKernel", "WolframKernel.exe"]) {
    const candidate = path.join(dir, name);
    if (await isFile(candidate)) { return candidate; }
  }
  return undefined;
}
