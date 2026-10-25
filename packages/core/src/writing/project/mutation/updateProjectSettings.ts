// Rewrites the settings of a project's labshelf.yaml in place, keeping every field and comment it does not patch.
import { PROJECT_FILE, parseProjectFile, updateProjectFile, type ProjectSettingsPatch } from "../projectFile.js";
import type { ProjectReadContext } from "../folder/index.js";

/** A labshelf.yaml that does not parse is left untouched and the call fails. */
export async function updateProjectSettings(
  { fs, paths, logger }: ProjectReadContext, folder: string, patch: ProjectSettingsPatch,
): Promise<void> {
  const file = paths.join(folder, PROJECT_FILE);
  const text = await fs.readText(file);
  const parsed = parseProjectFile(text);
  if (!parsed.ok) { throw new Error(`${file}: ${parsed.reason}`); }
  await fs.writeText(file, updateProjectFile(text, patch));
  await logger.log("INFO", "project", "project settings updated", { folder, keys: Object.keys(patch) });
}
