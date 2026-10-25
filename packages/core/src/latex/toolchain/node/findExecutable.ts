// Finds an executable file on PATH, honouring PATHEXT on Windows.
import { promises as fs, constants } from "node:fs";
import * as path from "node:path";

async function isExecutable(file: string): Promise<boolean> {
  try {
    if (!(await fs.stat(file)).isFile()) { return false; }
    await fs.access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  // PLATFORM: Windows environment variable names are case-insensitive, so PATH may be spelled Path.
  const name = Object.keys(env).find((candidate) => candidate.toUpperCase() === key);
  return name === undefined ? undefined : env[name];
}

/** The first match for `name` on PATH, or undefined. */
export async function findExecutable(name: string, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const dirs = (envValue(env, "PATH") ?? "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32"
    ? (envValue(env, "PATHEXT") ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)
    : [""];
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, name + extension);
      if (await isExecutable(candidate)) { return candidate; }
    }
  }
  return undefined;
}
