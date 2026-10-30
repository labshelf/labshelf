// Finds wolframscript or Rscript: an explicit override, then PATH, then the usual install locations of each OS.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { envValue, findExecutable, subdirs } from "../../../latex/node/systemTex.js";

type LocatedTool = "wolframscript" | "Rscript";

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
async function windowsDirs(tool: LocatedTool, env: NodeJS.ProcessEnv): Promise<string[]> {
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

function macDirs(tool: LocatedTool): string[] {
  const common = ["/usr/local/bin", "/opt/homebrew/bin"];
  if (tool === "Rscript") { return ["/Library/Frameworks/R.framework/Resources/bin", ...common]; }
  const apps = ["Wolfram Engine", "Mathematica", "Wolfram"].map((app) => `/Applications/${app}.app/Contents/MacOS`);
  return [...apps, ...common];
}

/** The path of `tool`, or undefined when it is nowhere: override first, then PATH, then the install locations of `platform`. */
export async function locateTool(tool: LocatedTool, options: LocateToolOptions = {}): Promise<string | undefined> {
  const { override, platform = process.platform, env = process.env, exists = isFile } = options;
  if (override && await exists(override)) { return override; }
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
