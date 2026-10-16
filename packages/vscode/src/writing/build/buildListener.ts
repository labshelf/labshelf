// Types the notifications a build sends to whoever shows its result: when a compile starts and how it finished.
import type { LatexBuildResult } from "@labshelf/core";
import type { TypstBuildResult } from "@labshelf/core/typst";
import type { ReadyProject } from "../mainDocument.js";

export type BuildTrigger = "command" | "save";

/** A Typst build's success also carries where it placed each citation. */
export type FinishedBuild = Exclude<LatexBuildResult, { status: "cancelled" }> | TypstBuildResult;

/** Told when a project's compile starts and when it ends; a cancelled compile never ends, the next one replaces it. */
export interface BuildListener {
  building(projectFolder: string): void;
  finished(project: ReadyProject, result: FinishedBuild, trigger: BuildTrigger): void;
}
