/** Implements PathOps with node:path, for hosts that run on the local file system. */
import path from "node:path";

import type { PathOps } from "../pathOps.js";

export const nodePathOps: PathOps = path;
