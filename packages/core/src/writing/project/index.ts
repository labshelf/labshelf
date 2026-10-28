/** Exports the runtime-neutral project model: labshelf.yaml, reading a project folder, main and root detection, root build folders, project ids, the registry, the project values and the version snapshots. */
export { buildRootOf, detectFormat, detectEntryFile, findBuildRoots, findEntryCandidates, deriveBuildRootFolder } from "./buildRoot.js";
export {
  DEFAULT_BIBLIOGRAPHY, LATEX_ENGINES, PROJECT_FILE, PROJECT_FORMATS,
  parseProjectFile, withProjectId, serializeProjectFile, updateProjectFile, deriveProjectIdSlug,
} from "./projectFile.js";
export type {
  CheckLimits, CheckSettings, CountUpTo, FigureRecipe, LatexEngine, ListedPaper, ProjectFileResult,
  ProjectFormat, ProjectSettings, ProjectSettingsUpdate, ProjectSubmission, UserSettings,
} from "./projectFile.js";
export { readProjectEntry, type ProjectEntry, type ProjectFolderReader, type ProjectPlacement } from "./projectEntry.js";
export {
  loadProjectRegistry, parseProjectRegistry, createProjectFolderRegistry, registerProjectFolder, serializeProjectRegistry,
  removeProjectFolder, withFolder, withProjectFolderRemoved,
} from "./projectRegistry.js";
export type { ProjectRegistry, ProjectRegistryFileContext } from "./projectRegistry.js";
export {
  createInstallPlan, describeInstall, isInstallResolved, describeInstallReport, createArxivBundle, deriveBuiltPdfPaths, isBuildOrToolPath,
  deriveProjectFiles, DOCUMENT_EXPORT_EXTENSIONS, createPandocArgs,
} from "./projectExport.js";
export type { InstallEntry, InstallLine, InstallResult, ArxivBundle, BibliographyText, DocumentExport } from "./projectExport.js";
export {
  readLastModified, listProjectFiles, findLibraryProjectFolder, listProjects, readProject, listBuildRootFileNames, listDirEntries, readOptionalText,
  listBibliographyFiles,
} from "./projectReads.js";
export type { ProjectReadContext, OpenSources } from "./projectReads.js";
export { addExistingFolder, createProjectFromTemplate, removeProjectFolderForever, createProjectId, updateProjectSettings, createProjectCatalog } from "./projectMutations.js";
export type { ProjectCatalogContext, ProjectFolderRegistry } from "./projectMutations.js";
export {
  readProjectValues, deriveProjectValueLeaves, deriveProjectValueMembers, VALUES_FILE_NAME, VALUES_HEADER, createProjectValueFile,
  deriveProjectValueFilePath, withProjectValueInput, findLatexProjectValueStart, findLatexProjectValue, findTypstProjectValue,
  findTypstProjectValuePrefix,
} from "./projectValues.js";
export type {
  FlattenedProjectValues, LeafProjectValue, ProjectValueLeaf, ProjectValueSource, ProjectValueMember, ProjectValueInputResult,
  LatexProjectValueReference, TypstProjectValuePrefix, TypstProjectValueReference,
} from "./projectValues.js";
export { listVersions, deriveVersionSlug, parseVersionFile, serializeVersionFile, addProjectVersion, VERSIONS_DIR, VERSION_FILE, VERSION_PDF, VERSION_SOURCES } from "./versionSnapshots.js";
export type { VersionEntry, MarkVersionRequest, ProjectVersion } from "./versionSnapshots.js";
