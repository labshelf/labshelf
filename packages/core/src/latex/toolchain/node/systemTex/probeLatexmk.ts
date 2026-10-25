// Finds latexmk on PATH first and then in a list of directories.
import { delimiter } from "node:path";

import { findExecutable } from "../index.js";

export async function probeLatexmk(dirs: string[], env: NodeJS.ProcessEnv): Promise<string | undefined> {
  return (await findExecutable("latexmk", env))
    ?? (await findExecutable("latexmk", { PATH: dirs.join(delimiter), PATHEXT: env.PATHEXT }));
}
