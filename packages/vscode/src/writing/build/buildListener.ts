// Types the notifications a build sends to whoever shows its result: when a compile starts and how it finished.
import type { LatexBuildResult } from "@labshelf/core";
import type { TypstBuildResult } from "@labshelf/core/typst";
import type { ReadyProject } from "../mainDocument.js";

export type BuildTrigger = "command" | "save" | "focus";

/** A Typst build's success also carries where it placed each citation. */
export type FinishedBuild = Exclude<LatexBuildResult, { status: "cancelled" }> | TypstBuildResult;

/**
 * Told when the compile of a project's root starts and when it ends; a cancelled compile never ends, the next one replaces it.
 * `root` is the compiled file relative to the project folder.
 */
export interface BuildListener {
  building(projectFolder: string, root: string): void;
  finished(project: ReadyProject, root: string, result: FinishedBuild, trigger: BuildTrigger): void;
}
