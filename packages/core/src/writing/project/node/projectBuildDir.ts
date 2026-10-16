/** Names the cache folder that holds a project's build output, so the project folder stays free of auxiliary files. */
import * as path from "node:path";

import { cacheDir } from "../../../library/node/index.js";

export function projectBuildDir(projectId: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(cacheDir(env), "builds", projectId);
}
