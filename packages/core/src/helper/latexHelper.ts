/** Declares the port an app implements to build LaTeX projects through LabShelf Helper. */
// CONTRACT: documents/contracts/helper.md#version

import type { LocatedProblem, TexInstallKind } from "../latex/index.js";
import type { LatexEngine } from "../writing/project/index.js";
import type { CompileMode, HelperBuildState, HelperHost, HelperProgress, TexToolchain, TextChange } from "./helperMessages.js";

/**
 * "update-helper" when the helper's protocol is lower than the page's, "update-extension" when it is higher.
 * A helper that refused the page's `hello` for its version never said which program runs it, so `host` is then undefined.
 */
export type HelperState =
  | { state: "not-installed" }
  | { state: "update-helper"; protocol: number; host: HelperHost | undefined }
  | { state: "update-extension"; protocol: number }
  | { state: "ready"; helperVersion: string; tex: TexToolchain; host: HelperHost };

export type HelperProgressListener = (progress: HelperProgress) => void;

export interface HelperCompileRequest {
  projectId: string;
  main: string;
  mode: CompileMode;
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

import type { TemplatePublishRequest, TemplatePublishEvent } from "./template/index.js";

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
  compile(request: HelperCompileRequest, onProgress: HelperProgressListener): Promise<HelperCompileResult>;
  cancel(projectId: string): Promise<void>;
  installTex(kind: TexInstallKind, onProgress: HelperProgressListener): Promise<void>;
  installAllPackages(onProgress: HelperProgressListener): Promise<void>;
}
