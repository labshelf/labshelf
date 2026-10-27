/** Declares every message an extension page and LabShelf Helper exchange, with the protocol's version and limits. */
// CONTRACT: documents/contracts/helper.md#messages

import type { LocatedProblem, TexInstallKind } from "../latex/index.js";
import type { HostToGallery, PublishDraft, PublishFromHost } from "../templates/index.js";
import type { LatexEngine } from "../writing/project/index.js";

export const HELPER_HOST_NAME = "dev.labshelf.helper";
export const PROTOCOL_VERSION = 5;
// The helper program's version, kept beside the program so every app that bundles it reports the same one.
export const HELPER_VERSION = "0.3.0";

// CONTRACT: documents/contracts/helper.md#messages
export const MAX_SOCKET_MESSAGE_BYTES = 16 * 1024 * 1024;
export const MAX_OPEN_PROJECTS = 8;
export const MAX_PROJECT_FILES = 5000;
export const MAX_PROJECT_BYTES = 500 * 1024 * 1024;
export const MAX_EDIT_CHANGES = 10000;
export const MAX_PATH_LENGTH = 260;

export const TEX_SOURCES = ["none", "tinytex", "texlive", "system"] as const;
export type TexSource = (typeof TEX_SOURCES)[number];
/** The program that answers: the standalone LabShelf Helper, or a desktop app running the helper script. */
export const HELPER_HOSTS = ["helper", "vscode", "terminal"] as const;
export type HelperHost = (typeof HELPER_HOSTS)[number];
export const PROGRESS_PHASES = ["installing-tex", "installing-package", "building", "updating"] as const;
export type HelperPhase = (typeof PROGRESS_PHASES)[number];
export const HELPER_BUILD_STATUSES = ["succeeded", "failed", "cancelled", "toolchain-missing", "needs-shell-escape"] as const;
export type HelperBuildState = (typeof HELPER_BUILD_STATUSES)[number];

export const COMPILE_MODES = ["preview", "full"] as const;
export type BuildKind = (typeof COMPILE_MODES)[number];
export interface TexToolchain { source: TexSource; year?: number; complete: boolean }
export interface HelperProgress { phase: HelperPhase; message: string; fraction?: number }
/** Replaces the characters `from` to `to` of the previous version's text with `insert`. */
export interface TextChange { from: number; to: number; insert: string }
export interface ChangedPage { index: number; offset: number; length: number }

type Envelope<T extends string> = { v: number; id: string; type: T };

// Template publication socket messages.
export type TemplatePublishRequest =
  | { action: "open" }
  | { action: "check"; draft: PublishDraft }
  | { action: "submit"; draft: PublishDraft; token: string };
export type TemplatePublishMessage = { v: number; id: string; type: "publishTemplate"; projectId: string } & TemplatePublishRequest;
export type TemplatePublishEvent = PublishFromHost | Extract<HostToGallery, { type: "notice" }>;
export type TemplatePublishReply = { v: number; id: string; type: "templatePublish"; event?: TemplatePublishEvent; done: boolean };

export type ToHelperMessage =
  | TemplatePublishMessage
  | Envelope<"templateThumbnail"> & { requestId: string; error?: string }
  | Envelope<"hello"> & { extensionVersion: string; origin: string }
  | Envelope<"auth"> & { token: string }
  | Envelope<"openProject"> & { projectId: string; root: string }
  | Envelope<"closeProject"> & { projectId: string }
  | Envelope<"edit"> & { projectId: string; path: string; version: number } & (
    | { text: string; changes?: undefined }
    | { changes: TextChange[]; text?: undefined })
  | Envelope<"save"> & { projectId: string; path: string }
  | Envelope<"compile"> & { projectId: string; main: string; mode: BuildKind; engine?: LatexEngine; editedFile?: string; editedLine?: number; haltOnError?: boolean }
  | Envelope<"cancel"> & { projectId: string }
  | Envelope<"installTex"> & { kind: TexInstallKind }
  | Envelope<"installAllPackages">;

export type ToPageMessage =
  | TemplatePublishReply
  | Envelope<"templatePreview">
  | Envelope<"ready"> & { protocol: number; helperVersion: string; host: HelperHost; tex: TexToolchain }
  | Envelope<"session"> & { port: number; token: string }
  | Envelope<"authed">
  | Envelope<"opened"> & { projectId: string; files: string[] }
  | Envelope<"closed"> & { projectId: string }
  | Envelope<"progress"> & HelperProgress
  | Envelope<"built"> & { status: HelperBuildState; problems: LocatedProblem[]; pdfSha256?: string }
  | Envelope<"pages"> & { pdfSha256: string; pageCount: number; changed: ChangedPage[] }
  | (Omit<Envelope<"error">, "id"> & { id?: string | undefined; code: string; message: string });

export type HelperDirection = "toHelper" | "toPage";

/** Why a frame was refused; the helper sends it back as the `code` of an `error` reply. */
export type HelperRejectionKind = "malformed" | "version" | "unknown-type" | "invalid-field" | "path" | "project-id" | "stale" | "no-library" | "limit";

export interface HelperRejection {
  ok: false;
  code: HelperRejectionKind;
  reason: string;
  /** The frame's id when it had one, so the reply can pair with it. */
  id?: string;
  /** The frame's `v` when it was a number other than PROTOCOL_VERSION. */
  received?: number;
}

export type HelperParseResult<M> = { ok: true; message: M } | HelperRejection;
