// Deletes a project from the device: a library project's folder is removed, any other folder is only forgotten.
import { libraryLayout } from "../../../library/index.js";
import { pathRelation } from "./pathRelation.js";
import type { ProjectCatalogContext } from "./projectCatalogContext.js";

const MODULE = "project";

/** Never removes files outside `<library>/projects/`: a registered folder belongs to the user. */
export async function deleteProjectForever(context: ProjectCatalogContext, libraryRoot: string, folder: string): Promise<void> {
  const { fs, paths, logger, registry } = context;
  const root = paths.resolve(libraryLayout(libraryRoot, (base, ...segments) => paths.join(base, ...segments)).projectsRoot());
  const target = paths.resolve(folder);
  const relation = pathRelation(paths, root, target);
  if (relation === "same") { throw new Error(`refusing to delete ${target}: it is the projects folder of the library`); }
  if (relation === "outside") {
    await registry.unregister(libraryRoot, target);
    await logger.log("INFO", MODULE, "project deleted forever", { folder: target, branch: "unregistered, files kept" });
    return;
  }
  try {
    await fs.removeTree(target);
  } catch (error) {
    await logger.error(MODULE, error, { folder: target, action: "delete forever" });
    throw new Error(`deleting ${target} failed`, { cause: error });
  }
  await logger.log("INFO", MODULE, "project deleted forever", { folder: target, branch: "folder removed" });
}
