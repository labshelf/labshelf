// Describes what the managed TeX installers need from the host and from the caller.
import type { ILogger } from "../../../../../../ports/index.js";
import type { FetchLike } from "../../index.js";

export interface TexInstallDeps {
  fetchImpl: FetchLike;
  logger: ILogger;
}

export interface TexInstallRun {
  /** The shared TeX folder; see sharedTexRoot. */
  texRoot: string;
  /** A fraction in 0..1, or null while the step has no measurable progress. */
  onProgress: (fraction: number | null) => void;
}
