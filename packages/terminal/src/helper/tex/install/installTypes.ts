// Describes what the managed TeX installers need from the host and from the caller.
import type { ILogger } from "@labshelf/core";
import type { FetchLike } from "@labshelf/core/node";

export interface TexInstallDeps {
  fetchImpl: FetchLike;
  logger: ILogger;
}

export interface TexInstallRun {
  dataDir: string;
  /** A fraction in 0..1, or null while the step has no measurable progress. */
  onProgress: (fraction: number | null) => void;
}
