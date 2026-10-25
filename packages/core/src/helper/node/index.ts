// Exports what an app needs to run LabShelf Helper in a Node process: the host loop, its building blocks, its data folder and its logger.
export { helperDataDir } from "./helperDir.js";
export { createHelperLogger } from "./log/index.js";
export type { HelperLogger } from "./log/index.js";
export { assertHelperPrivatePaths } from "./privacyCheck/index.js";
export { runHelperBiber } from "./runHelperBiber.js";
export { BIBER_ASSET_FILES, BIBER_FLAG, parseBiberManifest, type BiberWasmAssets } from "../../latex/biber/index.js";
export { runHelperHost } from "./runHelperHost.js";
export type { HelperHostOptions } from "./runHelperHost.js";
export { runHelperScriptHost } from "./runHelperScriptHost.js";
export { startHelperSocket } from "./connection/index.js";
export type { HelperSocket, HelperSocketOptions } from "./connection/index.js";
export { diffPages } from "./diffPages.js";
export type { PageDiff } from "./diffPages.js";
export { createHelperProjects, HelperProjectError } from "./projects/index.js";
export type { EditBody, HelperProjectErrorCode, HelperProjects, HelperProjectsOptions } from "./projects/index.js";
export { downloadVerified } from "../../latex/toolchain/node/downloadVerified.js";
export type { FetchLike } from "../../latex/toolchain/node/downloadVerified.js";
