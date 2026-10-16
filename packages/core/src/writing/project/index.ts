/** Exports the runtime-neutral project model: labshelf.yaml, main detection, project ids, templates and the registry. */
export type { CheckSettings, FigureRecipe, UserKeys } from "./userKeys.js";
export { detectFormat, detectMainFile, mainCandidates } from "./mainDetection.js";
export {
  DEFAULT_BIBLIOGRAPHY, LATEX_ENGINES, PROJECT_FILE, PROJECT_FORMATS,
  parseProjectFile, serializeProjectFile, updateProjectFile,
} from "./projectFile.js";
export type { LatexEngine, ProjectFileResult, ProjectFormat, ProjectSettings, ProjectSettingsPatch } from "./projectFile.js";
export { projectIdSlug } from "./projectId.js";
export { parseProjectRegistry, serializeProjectRegistry, withFolder, withoutFolder } from "./projectRegistry.js";
export type { ProjectRegistry } from "./projectRegistry.js";
export { projectTemplate } from "./templates.js";
