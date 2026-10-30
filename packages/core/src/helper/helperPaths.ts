/** Checks that a project path or project id is safe inside the helper's data folder, frames one helper socket message, and declares the port an app implements to build LaTeX through LabShelf Helper. */
// CONTRACT: documents/contracts/helper.md#messages

import type { CellLanguage, CellResult } from "../qmd/compute/index.js";
import type { LocatedProblem, TexInstallKind } from "../latex/index.js";
import type { LatexEngine } from "../writing/project/index.js";
import {
  MAX_PATH_LENGTH, MAX_SOCKET_MESSAGE_BYTES,
  type BuildKind, type HelperBuildState, type HelperHost, type HelperProgress, type TemplatePublishEvent, type TemplatePublishRequest,
  type PythonState, type TexToolchain, type TextChange,
} from "./helperMessages.js";

// INVARIANT: matches what deriveProjectIdSlug produces, so every id LabShelf derives passes and none can name a parent folder.
const PROJECT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DRIVE_LETTER = /^[A-Za-z]:/;

/** The reason a relative POSIX project path is refused, or undefined when it is safe. */
export function checkHelperPath(path: string): string | undefined {
  if (path === "") { return "path is empty"; }
  if (path.length > MAX_PATH_LENGTH) { return `path is longer than ${MAX_PATH_LENGTH} characters`; }
  if (path.includes("\u0000")) { return "path contains NUL"; }
  if (path.includes("\\")) { return "path contains a backslash"; }
  if (path.startsWith("/")) { return "path is absolute"; }
  if (DRIVE_LETTER.test(path)) { return "path starts with a drive letter"; }
  for (const segment of path.split("/")) {
    if (segment === "") { return "path has an empty segment"; }
    if (segment === "." || segment === "..") { return `path has a ${segment} segment`; }
  }
  return undefined;
}

export function isHelperProjectId(id: string): boolean {
  return PROJECT_ID.test(id);
}

// Encodes and decodes one helper socket message: a 4-byte little-endian JSON length, the UTF-8 JSON envelope, then raw payload bytes.
// CONTRACT: documents/contracts/helper.md#transport

export interface ConnectionMessage {
  envelope: Record<string, unknown>;
  payload: Uint8Array;
}

const LENGTH_BYTES = 4;

export function encodeConnectionMessage(envelope: object, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(envelope));
  const total = LENGTH_BYTES + json.length + payload.length;
  if (total > MAX_SOCKET_MESSAGE_BYTES) {
    throw new Error(`Socket message of ${total} bytes is over the 16 MiB limit`);
  }
  const bytes = new Uint8Array(total);
  new DataView(bytes.buffer).setUint32(0, json.length, true);
  bytes.set(json, LENGTH_BYTES);
  bytes.set(payload, LENGTH_BYTES + json.length);
  return bytes;
}

export function decodeConnectionMessage(bytes: Uint8Array): ConnectionMessage {
  if (bytes.length > MAX_SOCKET_MESSAGE_BYTES) {
    throw new Error(`Socket message of ${bytes.length} bytes is over the 16 MiB limit`);
  }
  if (bytes.length < LENGTH_BYTES) {
    throw new Error(`Socket message of ${bytes.length} bytes is shorter than its length prefix`);
  }
  const jsonLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  const jsonEnd = LENGTH_BYTES + jsonLength;
  if (jsonEnd > bytes.length) {
    throw new Error(`Socket message declares a ${jsonLength}-byte envelope but holds ${bytes.length - LENGTH_BYTES} bytes`);
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(LENGTH_BYTES, jsonEnd));
  const envelope: unknown = JSON.parse(text);
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
    throw new Error("Socket message envelope is not a JSON object");
  }
  return { envelope: envelope as Record<string, unknown>, payload: bytes.subarray(jsonEnd) };
}

// The port an app implements to build LaTeX projects through LabShelf Helper.
// CONTRACT: documents/contracts/helper.md#version

/**
 * "update-helper" when the helper's protocol is lower than the page's, "update-extension" when it is higher.
 * A helper that refused the page's `hello` for its version never said which program runs it, so `host` is then undefined.
 */
export type HelperState =
  | { state: "not-installed" }
  | { state: "update-helper"; protocol: number; host: HelperHost | undefined }
  | { state: "update-extension"; protocol: number }
  | { state: "ready"; helperVersion: string; tex: TexToolchain; host: HelperHost; python?: PythonState };

export type OnHelperProgress = (progress: HelperProgress) => void;

export interface HelperCompileRequest {
  projectId: string;
  main: string;
  mode: BuildKind;
  /** For a `.tex` main. */
  engine?: LatexEngine;
  editedFile?: string;
  /** 1-based line of the edit in `editedFile`. */
  editedLine?: number;
  /** Stops the LaTeX engine at the first error. */
  haltOnError?: boolean;
}

/** One page of the PDF as a standalone one-page PDF. */
export interface HelperPageBytes { index: number; bytes: Uint8Array }

/** `changed` holds only the pages that differ from the previous result for the project on this connection. */
export interface HelperCompileResult {
  status: HelperBuildState;
  problems: LocatedProblem[];
  /** Present when `status` is "succeeded". */
  pdfSha256?: string;
  pageCount?: number;
  changed: HelperPageBytes[];
}

/** The whole text of a file, or edits against the text of the previous version. */
export type HelperChange = { text: string } | { changes: TextChange[] };


/** `cwd` names a project id or `paper:<paperId>`; the helper resolves it to a folder and refuses one it does not know. `noteKey` names the note whose `language` session runs the code. */
export interface HelperCellRequest { code: string; cwd: string; timeoutMs: number; language: CellLanguage; noteKey: string }

export interface ILatexHelper {
  publishTemplate(projectId: string, request: TemplatePublishRequest, onEvent: (event: TemplatePublishEvent) => void, renderThumbnail: (pdf: Uint8Array) => Promise<Uint8Array>): Promise<void>;
  disconnect(): void;
  /** Opens the native host, exchanges hello/ready and, when the helper is ready, opens and authenticates the session socket. */
  connect(): Promise<HelperState>;
  /** The status the last connect reached, or undefined before the first connect and after the connection closes. */
  status(): HelperState | undefined;
  /** Opens the project folder `root` (a library path) in the helper and returns the project's file paths. */
  openProject(projectId: string, root: string): Promise<{ files: string[] }>;
  closeProject(projectId: string): Promise<void>;
  /** The first edit of a path after `openProject` or `save` carries its whole `text`; later ones may carry `changes`. */
  edit(projectId: string, path: string, version: number, edit: HelperChange): Promise<void>;
  /** Tells the helper the page wrote `path` to the library, so it reads the file from disk again. */
  save(projectId: string, path: string): Promise<void>;
  compile(request: HelperCompileRequest, onProgress: OnHelperProgress): Promise<HelperCompileResult>;
  cancel(projectId: string): Promise<void>;
  installTex(kind: TexInstallKind, onProgress: OnHelperProgress): Promise<void>;
  installAllPackages(onProgress: OnHelperProgress): Promise<void>;
  installPython(onProgress: OnHelperProgress): Promise<void>;
  /** Runs one code cell in the note's session for its language; aborting `signal` cancels the run, which then settles as `cancelled`. */
  runCell(request: HelperCellRequest, signal: AbortSignal): Promise<CellResult>;
  /** Drops the `language` session the note `noteKey` holds in the helper; the helper does not wait for a run in flight and sends no reply. */
  restartCell(noteKey: string, language: CellLanguage): Promise<void>;
}
