// Builds the PATH value that puts the directory of the toolchain's latexmk first.
import { delimiter, dirname } from "node:path";

import type { LatexToolchain } from "@labshelf/core";

// TRAP: core's ensureToolchain and latexmk itself look executables up by name on PATH, so the build handler sets this before buildProject.
export function withToolchainOnPath(toolchain: LatexToolchain, env: NodeJS.ProcessEnv): string {
  const dir = dirname(toolchain.executable);
  // PLATFORM: Windows environment variable names are case-insensitive, so PATH may be spelled Path.
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH");
  const rest = ((key === undefined ? undefined : env[key]) ?? "").split(delimiter).filter((entry) => entry && entry !== dir);
  return [dir, ...rest].join(delimiter);
}
