// The request and handler types of the deck Style panel's build copies, shared by the workspace host and the Node-side compiler.
import type { ReadyProject } from "../projects/index.js";

/** One request of the Style panel's preview: the deck's text in a candidate style. */
export interface StylePreviewRequest {
  project: ReadyProject;
  /** The deck file, relative to the project folder with "/" separators. */
  root: string;
  /** What requests for one file supersede each other by. */
  path: string;
  text: string;
  key: string;
}

/** Gives the PDF bytes (base64) of the build copy, or undefined when it could not be built or a newer request replaced it. */
export type StylePreviewHandler = (request: StylePreviewRequest) => Promise<string | undefined>;
