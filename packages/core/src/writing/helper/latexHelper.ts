/** Declares the port an app implements to build LaTeX projects through LabShelf Helper. */
// CONTRACT: documents/contracts/helper.md#version

import type { LocatedProblem, TexInstallKind } from "../latex/index.js";
import type { LatexEngine } from "../project/index.js";
import type { HelperBuildStatus, HelperHost, HelperProgress, TexStatus } from "./helperMessages.js";

/** "update-helper" when the helper's protocol is lower than the page's, "update-extension" when it is higher. */
export type HelperStatus =
  | { state: "not-installed" }
  | { state: "update-helper"; protocol: number; host: HelperHost }
  | { state: "update-extension"; protocol: number }
  | { state: "ready"; helperVersion: string; tex: TexStatus; host: HelperHost };

export interface HelperProjectFile { path: string; bytes: Uint8Array }

export interface HelperProject {
  projectId: string;
  main: string;
  engine: LatexEngine;
  files: readonly HelperProjectFile[];
}

export type HelperCompileResult =
  | { status: "succeeded"; problems: LocatedProblem[]; pdf: Uint8Array }
  | { status: Exclude<HelperBuildStatus, "succeeded">; problems: LocatedProblem[] };

export type HelperProgressListener = (progress: HelperProgress) => void;

export interface ILatexHelper {
  /** Opens the native host and exchanges hello/ready. */
  connect(): Promise<HelperStatus>;
  /** The status the last connect reached, or undefined before the first. */
  status(): HelperStatus | undefined;
  /** Syncs the project's files, builds it, and returns the outcome with the PDF bytes on success. */
  compile(project: HelperProject, onProgress: HelperProgressListener): Promise<HelperCompileResult>;
  cancel(projectId: string): Promise<void>;
  installTex(kind: TexInstallKind, onProgress: HelperProgressListener): Promise<void>;
  installAllPackages(onProgress: HelperProgressListener): Promise<void>;
}
