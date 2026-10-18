// Picks a project id from a title that no listed project and no folder under projects/ already uses.
import { claimCiteKey, libraryLayout } from "../../../library/index.js";
import { listProjects } from "../folder/index.js";
import { projectIdSlug } from "../projectId.js";
import type { ProjectCatalogContext } from "./projectCatalogContext.js";

// INVARIANT: project ids are unique across the library and the registry, because the build cache is keyed by id.
export async function claimProjectId(context: ProjectCatalogContext, libraryRoot: string, title: string): Promise<string> {
  const { fs, paths, registry } = context;
  const entries = await listProjects(context, libraryRoot, await registry.folders(libraryRoot));
  const ids = entries.flatMap((entry) => entry.kind === "ready" ? [entry.settings.id] : []);
  const root = libraryLayout(libraryRoot, (base, ...segments) => paths.join(base, ...segments)).projectsRoot();
  const folderExists = async (id: string) => (await fs.stat(paths.join(root, id))) !== undefined;
  return claimCiteKey(projectIdSlug(title), ids, folderExists);
}
