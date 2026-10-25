/** Reads the JSON files a project lists under `values:` into their leaves. */
// CONTRACT: documents/contracts/library-format.md#labshelfyaml
import type { ProjectReadContext } from "../project/folder/index.js";
import { deriveProjectValueLeaves, deriveProjectValueFileBase, type ProjectValueLeaf, type ProjectValueSource } from "./projectValueLeaves.js";
import { deriveProjectValueFilePath } from "./projectValueFile.js";

const MODULE = "writing/projectValue";

/** Leaves of every readable value file, in the order the files are listed; a missing or invalid file, or one whose name an earlier file already took, is logged and skipped. */
export async function readProjectValues(project: Pick<ProjectValueSource, "folder" | "settings">, { fs, paths, logger }: ProjectReadContext): Promise<ProjectValueLeaf[]> {
  const leaves: ProjectValueLeaf[] = [];
  const bases = new Set<string>();
  for (const listed of project.settings.values ?? []) {
    const file = deriveProjectValueFilePath(listed);
    const context = { project: project.settings.id, file };
    if (bases.has(deriveProjectValueFileBase(file))) {
      await logger.log("WARN", MODULE, "value file skipped: an earlier file has the same name", context);
      continue;
    }
    bases.add(deriveProjectValueFileBase(file));
    let json: unknown;
    try {
      json = JSON.parse(await fs.readText(paths.join(project.folder, file)));
    } catch (error) {
      await logger.log("WARN", MODULE, "value file skipped", { ...context, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const flat = deriveProjectValueLeaves(file, json);
    if (flat.skipped.length > 0) {
      await logger.log("WARN", MODULE, "value keys skipped: only letters, digits, '.', '-' and '_' are allowed", { ...context, keys: flat.skipped });
    }
    leaves.push(...flat.leaves);
  }
  return leaves;
}
