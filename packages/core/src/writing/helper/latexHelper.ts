/** Declares the port an app implements to build LaTeX projects through LabShelf Helper. */
// CONTRACT: documents/contracts/helper.md#version

import type { LocatedProblem, TexInstallKind } from "../latex/index.js";
import type { LatexEngine } from "../project/index.js";
import type { CompileMode, HelperBuildStatus, HelperHost, HelperProgress, TexStatus, TextChange } from "./helperMessages.js";

/** "update-helper" when the helper's protocol is lower than the page's, "update-extension" when it is higher. */
export type HelperStatus =
  | { state: "not-installed" }
  | { state: "update-helper"; protocol: number; host: HelperHost }
  | { state: "update-extension"; protocol: number }
  | { state: "ready"; helperVersion: string; tex: TexStatus; host: HelperHost };

export type HelperProgressListener = (progress: HelperProgress) => void;

export interface HelperCompileRequest {
  projectId: string;
  main: string;
  mode: CompileMode;
  /** For a `.tex` main. */
  engine?: LatexEngine;
  editedFile?: string;
}

/** One page of the PDF as a standalone one-page PDF. */
export interface HelperPageBytes { index: number; bytes: Uint8Array }

/** `changed` holds only the pages that differ from the previous result for the project on this connection. */
export interface HelperCompileResult {
  status: HelperBuildStatus;
  problems: LocatedProblem[];
  /** Present when `status` is "succeeded". */
  pdfSha256?: string;
  pageCount?: number;
  changed: HelperPageBytes[];
}

/** The whole text of a file, or edits against the text of the previous version. */
export type HelperEdit = { text: string } | { changes: TextChange[] };

export type HelperLspListener = (payload: Record<string, unknown>) => void;

export interface ILatexHelper {
  /** Opens the native host, exchanges hello/ready and, when the helper is ready, opens and authenticates the session socket. */
  connect(): Promise<HelperStatus>;
  /** The status the last connect reached, or undefined before the first connect and after the connection closes. */
  status(): HelperStatus | undefined;
  /** Opens the project folder `root` (a library path) in the helper and returns the project's file paths. */
  openProject(projectId: string, root: string): Promise<{ files: string[] }>;
  closeProject(projectId: string): Promise<void>;
  /** The first edit of a path after `openProject` or `save` carries its whole `text`; later ones may carry `changes`. */
  edit(projectId: string, path: string, version: number, edit: HelperEdit): Promise<void>;
  /** Tells the helper the page wrote `path` to the library, so it reads the file from disk again. */
  save(projectId: string, path: string): Promise<void>;
  compile(request: HelperCompileRequest, onProgress: HelperProgressListener): Promise<HelperCompileResult>;
  cancel(projectId: string): Promise<void>;
  installTex(kind: TexInstallKind, onProgress: HelperProgressListener): Promise<void>;
  installAllPackages(onProgress: HelperProgressListener): Promise<void>;
  /** Listens to the language server's messages for the project; returns the function that stops listening. */
  onLsp(projectId: string, listener: HelperLspListener): () => void;
  sendLsp(projectId: string, payload: Record<string, unknown>): Promise<void>;
}
