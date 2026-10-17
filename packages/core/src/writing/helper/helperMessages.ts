/** Declares every message an extension page and LabShelf Helper exchange, with the protocol's version and limits. */
// CONTRACT: documents/contracts/helper.md#messages

import type { LocatedProblem } from "../latex/index.js";

export const HELPER_HOST_NAME = "dev.labshelf.helper";
export const PROTOCOL_VERSION = 1;

// CONTRACT: documents/contracts/helper.md#limits
export const CHUNK_MAX_BYTES = 512 * 1024;
export const MAX_SYNC_FILES = 5000;
export const MAX_SYNC_TOTAL_BYTES = 500 * 1024 * 1024;
export const MAX_CHUNK_COUNT = MAX_SYNC_TOTAL_BYTES / CHUNK_MAX_BYTES;
export const MAX_PATH_LENGTH = 260;

export const HELPER_ENGINES = ["pdflatex", "xelatex", "lualatex"] as const;
export type HelperEngine = (typeof HELPER_ENGINES)[number];
export const TEX_INSTALL_KINDS = ["tinytex", "texlive"] as const;
export type TexInstallKind = (typeof TEX_INSTALL_KINDS)[number];
export const TEX_SOURCES = ["none", "tinytex", "texlive", "system"] as const;
export type TexSource = (typeof TEX_SOURCES)[number];
export const PROGRESS_PHASES = ["syncing", "installing-tex", "installing-package", "building", "updating"] as const;
export type ProgressPhase = (typeof PROGRESS_PHASES)[number];
export const HELPER_BUILD_STATUSES = ["succeeded", "failed", "cancelled", "toolchain-missing", "needs-shell-escape"] as const;
export type HelperBuildStatus = (typeof HELPER_BUILD_STATUSES)[number];

/** One slice of a byte stream: `data` is base64 of at most CHUNK_MAX_BYTES raw bytes. */
export interface HelperChunk { index: number; count: number; data: string }
export interface SyncedFile { path: string; sha256: string; size: number }
export interface TexStatus { source: TexSource; year?: number; complete: boolean }
export interface HelperProgress { phase: ProgressPhase; message: string; fraction?: number }

type Envelope<T extends string> = { v: number; id: string; type: T };

export type ToHelperMessage =
  | Envelope<"hello"> & { extensionVersion: string }
  | Envelope<"sync"> & { projectId: string; files: SyncedFile[] }
  | Envelope<"file"> & { projectId: string; path: string; chunk: HelperChunk }
  | Envelope<"delete"> & { projectId: string; paths: string[] }
  | Envelope<"build"> & { projectId: string; main: string; engine: HelperEngine }
  | Envelope<"cancel"> & { projectId: string }
  | Envelope<"installTex"> & { kind: TexInstallKind }
  | Envelope<"installAllPackages">;

export type ToPageMessage =
  | Envelope<"ready"> & { protocol: number; helperVersion: string; tex: TexStatus }
  | Envelope<"need"> & { paths: string[] }
  | Envelope<"progress"> & HelperProgress
  | Envelope<"built"> & { status: HelperBuildStatus; problems: LocatedProblem[]; pdfSha256?: string }
  | Envelope<"pdf"> & { chunk: HelperChunk }
  | Envelope<"error"> & { code: string; message: string };

export type HelperDirection = "toHelper" | "toPage";

/** Why a frame was refused; the helper sends it back as the `code` of an `error` reply. */
export type HelperRejectionCode = "malformed" | "version" | "unknown-type" | "invalid-field" | "path" | "project-id" | "limit";

export interface HelperRejection {
  ok: false;
  code: HelperRejectionCode;
  reason: string;
  /** The frame's id when it had one, so the reply can pair with it. */
  id?: string;
  /** The frame's `v` when it was a number other than PROTOCOL_VERSION. */
  received?: number;
}

export type HelperParseResult<M> = { ok: true; message: M } | HelperRejection;
