/** Deletes a project from the device: a library project's folder is removed, a registered folder is only forgotten. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { joinWith, libraryLayout } from "../../../library/index.js";
import type { ILogger } from "../../../ports/index.js";
import { unregisterProjectFolder } from "./projectRegistryFile.js";

const MODULE = "project";

function relationTo(root: string, target: string): "same" | "inside" | "outside" {
  const relative = path.relative(root, target);
  if (relative === "") { return "same"; }
  return relative.startsWith("..") || path.isAbsolute(relative) ? "outside" : "inside";
}

/** Never removes files outside `<library>/projects/`: a registered folder belongs to the user. */
export async function deleteProjectForever(libraryRoot: string, folder: string, logger: ILogger): Promise<void> {
  const root = path.resolve(libraryLayout(libraryRoot, joinWith(path.sep as "/" | "\\")).projectsRoot());
  const target = path.resolve(folder);
  const relation = relationTo(root, target);
  if (relation === "same") { throw new Error(`refusing to delete ${target}: it is the projects folder of the library`); }
  if (relation === "outside") {
    await unregisterProjectFolder(libraryRoot, target, logger);
    await logger.log("INFO", MODULE, "project deleted forever", { folder: target, branch: "unregistered, files kept" });
    return;
  }
  try {
    await fs.rm(target, { recursive: true, force: true });
  } catch (error) {
    await logger.error(MODULE, error, { folder: target, action: "delete forever" });
    throw new Error(`deleting ${target} failed`, { cause: error });
  }
  await logger.log("INFO", MODULE, "project deleted forever", { folder: target, branch: "folder removed" });
}
