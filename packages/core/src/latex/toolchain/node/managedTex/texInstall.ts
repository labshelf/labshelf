// Describes what the managed TeX installers need from the host and from the caller.
import type { ILogger } from "../../../../ports/index.js";
import type { FetchLike } from "../index.js";
import type { ExecFile } from "./removeQuarantine.js";

export interface TexInstallDeps {
  fetchImpl: FetchLike;
  logger: ILogger;
  platform: NodeJS.Platform;
  /** Runs xattr on macOS; tests inject a fake. */
  execFileImpl?: ExecFile;
}

export interface TexInstallRun {
  /** The shared TeX folder; `tex/` under sharedToolsRoot. */
  texRoot: string;
  /** A fraction in 0..1, or null while the step has no measurable progress. */
  onProgress: (fraction: number | null) => void;
}
