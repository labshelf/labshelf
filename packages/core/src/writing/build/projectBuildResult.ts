// Describes how a project build ended, from a built PDF to a toolchain that is not ready.
import type { LatexBuildResult } from "../latex/build/index.js";
import type { TypstBuildResult } from "../typst/index.js";

export type ProjectBuildResult =
  | LatexBuildResult
  | TypstBuildResult
  | { status: "no-main" }
  | { status: "toolchain-missing"; reason: "declined" | "tectonic-unsupported" | "tex-live-missing" }
  | { status: "toolchain-missing"; reason: "download-failed"; message: string };

export type ToolchainMissing = Extract<ProjectBuildResult, { status: "toolchain-missing" }>;
