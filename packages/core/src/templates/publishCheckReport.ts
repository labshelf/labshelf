// Declares the shapes of checking a writing project for submission to the template catalog and of the files a submission carries.
import type { ILogger } from "../ports/index.js";
import type { TemplateManifest } from "./templateManifest/index.js";
import type { PublishCheckId } from "./publishCheckLabels.js";

export interface PublishFile {
  /** Relative to the template's folder in the catalog. */
  path: string;
  bytes: Uint8Array;
}

export interface PublishCheck {
  id: PublishCheckId;
  ok: boolean;
  /** Why the check failed; absent when it passed. */
  message?: string;
}

/** `files`, `thumbnail` and `sample` are present only when every check passed. */
export interface PublishCheckReport {
  checks: PublishCheck[];
  ok: boolean;
  files?: PublishFile[];
  thumbnail?: Uint8Array;
  sample?: Uint8Array;
}

export type PublishBuildResult = { ok: true; pdf: Uint8Array } | { ok: false; problems: string[] };

export interface PublishCheckInput {
  projectFolder: string;
  manifest: TemplateManifest;
  /** Builds the project with its declared engine; never with shell escape. */
  buildPdf: () => Promise<PublishBuildResult>;
  /** Renders page 1 of the built PDF to a PNG. */
  renderThumbnail: (pdf: Uint8Array) => Promise<Uint8Array>;
  logger: ILogger;
}
