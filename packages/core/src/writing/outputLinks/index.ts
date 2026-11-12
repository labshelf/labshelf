/** Outputs of a code repository linked into a manuscript: the shared outputs file, the copies derived from the source files, the references in LaTeX and Typst, their states, and the service over the host's project and source ports. */
export {
  OUTPUTS_FILE_PATH, OUTPUTS_FILE_VERSION, OUTPUTS_FOLDER, checkOutputPath, createEmptyOutputsFile, createOutputLinkId, deriveOutputCopyPath, deriveOutputHash,
  formatOutputsFile, isOutputSourceName, parseOutputsFile,
  type OutputFormat, type OutputKind, type OutputLink, type OutputSourceRecord, type OutputsFile, type OutputsRead,
} from "./outputsFile.js";
export { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS, detectDelimiter, formatOutputTable, parseOutputTable, readOutputTableCopy, renderOutputTable, type OutputTable } from "./outputTables.js";
export {
  FIGURE_OUTPUT_EXTENSIONS, IMAGE_OUTPUT_EXTENSIONS, LINKABLE_OUTPUT_EXTENSIONS, TABLE_OUTPUT_EXTENSIONS,
  deriveOutputCopy, deriveOutputState, deriveOutputValueKey, describeOutputState, filterOutputValues, listOutputValueKeys,
  type OutputCopyOptions, type OutputLinkStatus, type OutputState,
} from "./outputCopy.js";
export { normalizeRemote, parseGitRemote } from "./gitRemote.js";
export {
  createOutputLinks,
  type OutputCreateInput, type OutputLinks, type OutputLinksDeps, type OutputPreview, type OutputProjectFiles, type OutputRunResult, type OutputSourcePort, type ResolvedOutputReference,
} from "./service.js";
export { buildOutputInsert, loadsBooktabs, scanOutputReferences, type OutputInsert, type OutputReference } from "./outputReferences.js";
