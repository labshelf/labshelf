// Shortens a path under the home folder to the `~/…` form people recognise.
import * as path from "node:path";

import { isInside } from "../../../path/index.js";
import { nodePathOps } from "../../../path/node/index.js";

export function formatPath(target: string, home: string): string {
  const relative = path.relative(home, target);
  if (relative === "") { return "~"; }
  if (!isInside(nodePathOps, home, target)) { return target; }
  return `~/${relative.split(path.sep).join("/")}`;
}
