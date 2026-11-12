/** Exports the LabShelf Helper protocol: its messages, validation, the client port the browser implements, the page-side helper client over app transports and the wire form of the editor page calls (LaTeX helper and Typst compiles). */
export {
  CELL_STATUSES, COMPILE_MODES, HELPER_BUILD_STATUSES, HELPER_HOST_NAME, HELPER_HOSTS, HELPER_VERSION, MAX_CELL_CODE_BYTES, MAX_CELL_TIMEOUT_MS, MAX_EDIT_CHANGES,
  MAX_OPEN_PROJECTS, MAX_PATH_LENGTH, MAX_OCR_PNG_BYTES, MAX_PRINT_HTML_BYTES, MAX_PROJECT_BYTES, MAX_PROJECT_FILES, MAX_SOCKET_MESSAGE_BYTES,
  LINKED_OUTPUTS_CAPABILITY, MAX_SOURCE_COMMAND_BYTES, MAX_SOURCE_FOLDER_LENGTH, MAX_SOURCE_OUTPUT_CHARS, MAX_SOURCE_RUN_TIMEOUT_MS, SOURCE_RUN_STATUSES,
  OCR_CAPABILITY, OCR_FAILURES, PRINT_FAILURES, PRINT_PDF_CAPABILITY, PROGRESS_PHASES, PROTOCOL_VERSION, TEX_SOURCES,
} from "./helperMessages.js";
export type {
  ChangedPage, BuildKind, HelperBuildState, HelperDirection, HelperHost, HelperOcrFailure, HelperParseResult, HelperPrintFailure, HelperProgress,
  HelperRejection, HelperRejectionKind, HelperPhase, HelperSourceRunStatus, TemplatePublishEvent, TemplatePublishRequest, TexSource, TexToolchain, TextChange, ToHelperMessage, ToPageMessage,
} from "./helperMessages.js";
export { checkHelperPath, decodeConnectionMessage, encodeConnectionMessage, helperCanLinkOutputs, helperCanOcr, helperCanPrintPdf, isHelperProjectId } from "./helperPaths.js";
export type {
  ConnectionMessage, HelperCompileRequest, HelperCompileResult, HelperChange, HelperPageBytes, OnHelperProgress,
  HelperCellRequest, HelperOcrResult, HelperSourcePick, HelperSourceRunRequest, HelperSourceRunResult, HelperPrintRequest, HelperPrintResult, HelperState, ILatexHelper,
} from "./helperPaths.js";
export { parseHelperMessage } from "./parseHelperMessage.js";
export { checkSourceFolder } from "./sourceMessages.js";
export type { MessageFor } from "./parseHelperMessage.js";
export { createBuildScheduler } from "./buildScheduler.js";
export type { BuildScheduler, BuildSchedulerOptions, BuildTimers } from "./buildScheduler.js";
export { mergePdfPages, singlePage } from "./pageMerge.js";
export type { ChangedPages } from "./pageMerge.js";

export { HelperClosedError, HelperConnection, HelperVersionError, deriveHelperStatus, runHandshake } from "./helperClientConnection.js";
export type {
  ConnectionHooks, FrameStep, Handshake, HandshakeDeps, HelperPortFactory, HelperSocketOpener, HelperTransport, RequestBody,
} from "./helperClientConnection.js";
export { NativeHelperSession, createNativeLatexHelper } from "./helperClient.js";
export type { NativeHelperSessionDeps } from "./helperClient.js";
export { UpdateTracker, createCompileStep, deriveProgress } from "./updateTracker.js";
export type { UpdateFrame } from "./updateTracker.js";
export { createHelperProject } from "./helperProject.js";
export type { BuildEvent, EditorHelperPort, HelperProblem, HelperProject } from "./helperProject.js";
