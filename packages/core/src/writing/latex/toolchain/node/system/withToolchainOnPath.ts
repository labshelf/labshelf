// Builds the environment that puts the directory of the toolchain's latexmk first on PATH.
import { delimiter, dirname } from "node:path";

import type { LatexToolchain } from "../../index.js";

// TRAP: latexmk looks the engine up by name on PATH, so a managed or off-PATH TeX needs its bin folder there.
// The environment is copied, never assigned to process.env, because the VS Code extension host is shared.
export function withToolchainOnPath(toolchain: LatexToolchain, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const dir = toolchain.binDir ?? dirname(toolchain.executable);
  // PLATFORM: Windows environment variable names are case-insensitive, so PATH may be spelled Path.
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH");
  const rest = ((key === undefined ? undefined : env[key]) ?? "").split(delimiter).filter((entry) => entry && entry !== dir);
  return { ...env, [key ?? "PATH"]: [dir, ...rest].join(delimiter) };
}
