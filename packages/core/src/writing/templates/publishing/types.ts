// Declares the ports of the shared template publication workflow.
import type { ILogger } from "../../../ports/index.js";
import type { GalleryToHost, HostToGallery } from "../protocol/index.js";
import type { PublishBuildResult, PublishCheckInput, PublishCheckReport } from "../publishTypes.js";
import type { SubmitTemplateInput, SubmitTemplateResult } from "../../../github/index.js";
import type { TemplateManifest } from "../manifest/index.js";

/** A writing project ready to publish: its build engine is already resolved. */
export interface PublishableProject {
  id: string;
  title: string;
  folder: string;
  /** Display name of the engine ("pdfLaTeX"). */
  engineLabel: string;
  format: TemplateManifest["format"];
  engine: TemplateManifest["engine"];
  /** Path of the main file, relative to the project folder. */
  main: string;
}

export type PublishMessage = Extract<GalleryToHost, { type: `publish.${string}` }>;

export interface GitHubSignIn {
  token: string;
  login: string;
}

export interface PublishPorts {
  logger: ILogger;
  post: (message: HostToGallery) => void;
  auth: {
    /** Throws when the user refuses or GitHub is unreachable. */
    signIn: () => Promise<GitHubSignIn>;
  };
  projects: {
    /** Quick pick of the projects; undefined when the user cancels. */
    pick: () => Promise<PublishableProject | undefined>;
    byId: (id: string) => Promise<PublishableProject | undefined>;
  };
  /** Builds the project with its declared engine. */
  buildPdf: (project: PublishableProject) => Promise<PublishBuildResult>;
  renderThumbnail: (pdf: Uint8Array) => Promise<Uint8Array>;
  check: (input: PublishCheckInput) => Promise<PublishCheckReport>;
  /** Opens the pull request; the adapter supplies `fetch`. */
  submit: (input: Omit<SubmitTemplateInput, "fetch" | "now" | "sleep">) => Promise<SubmitTemplateResult>;
  /** Saves the submitted template into the library's My templates. */
  saveToMyTemplates: (project: PublishableProject, manifest: TemplateManifest) => Promise<void>;
}
