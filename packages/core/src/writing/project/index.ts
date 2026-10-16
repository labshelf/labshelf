/** Exports the runtime-neutral project model: labshelf.yaml, main detection, project ids, templates and the registry. */
export type { CheckSettings, FigureRecipe, UserKeys } from "./userKeys.js";
export type { ListedPaper } from "./listedPapers.js";
export { detectFormat, detectMainFile, mainCandidates } from "./mainDetection.js";
export {
  DEFAULT_BIBLIOGRAPHY, LATEX_ENGINES, PROJECT_FILE, PROJECT_FORMATS,
  parseProjectFile, serializeProjectFile, updateProjectFile,
} from "./projectFile.js";
export type { LatexEngine, ProjectFileResult, ProjectFormat, ProjectSettings, ProjectSettingsPatch } from "./projectFile.js";
export { parseJsonObject } from "./deviceLocal/index.js";
export type { OpenSources } from "./openSources.js";
export type { ProjectEntry, ProjectLocation } from "./projectEntry.js";
export { projectIdSlug } from "./projectId.js";
export type { ProjectCursor, ProjectLastEdit } from "./deviceLocal/index.js";
export { parseProjectRegistry, serializeProjectRegistry, withFolder, withoutFolder } from "./deviceLocal/index.js";
export type { ProjectRegistry } from "./deviceLocal/index.js";
export * from "./install/index.js";
export { projectTemplate } from "./templates.js";
