/** Exports the LabShelf Helper protocol: its messages, validation, the client port the browser implements, the page-side helper client over app transports and the wire form of the editor page calls (LaTeX helper and Typst compiles). */
export {
  CELL_STATUSES, COMPILE_MODES, HELPER_BUILD_STATUSES, HELPER_HOST_NAME, HELPER_HOSTS, HELPER_VERSION, MAX_CELL_CODE_BYTES, MAX_CELL_TIMEOUT_MS, MAX_EDIT_CHANGES,
  MAX_OPEN_PROJECTS, MAX_PATH_LENGTH, MAX_PROJECT_BYTES, MAX_PROJECT_FILES, MAX_SOCKET_MESSAGE_BYTES,
  PROGRESS_PHASES, PROTOCOL_VERSION, TEX_SOURCES,
} from "./helperMessages.js";
export type {
  ChangedPage, BuildKind, HelperBuildState, HelperDirection, HelperHost, HelperParseResult, HelperProgress,
  HelperRejection, HelperRejectionKind, HelperPhase, TemplatePublishEvent, TemplatePublishRequest, TexSource, TexToolchain, TextChange, ToHelperMessage, ToPageMessage,
} from "./helperMessages.js";
export { checkHelperPath, decodeConnectionMessage, encodeConnectionMessage, isHelperProjectId } from "./helperPaths.js";
export type {
  ConnectionMessage, HelperCompileRequest, HelperCompileResult, HelperChange, HelperPageBytes, OnHelperProgress,
  HelperCellRequest, HelperState, ILatexHelper,
} from "./helperPaths.js";
export { parseHelperMessage } from "./parseHelperMessage.js";
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
