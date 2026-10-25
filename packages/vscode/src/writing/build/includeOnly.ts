// Remembers per project whether the preview builds only the focused `\include` chapter, and finds the chapter to build.
import { readLatexProjectSources, type BuildOptions, type ProjectSourceReader } from "@labshelf/core";

import type { ReadyProject } from "../buildRootDocument.js";

interface IncludeOnlyDeps {
  /** Reads the files of a project folder, open editors first. */
  readerFor(folder: string): ProjectSourceReader;
}

// \includeonly takes a comma list, so a path with anything else could change what it names.
const SAFE_PATH = /^[\w./-]+$/;

/** Mirrors how LaTeX completes an `\include` path: it adds `.tex` when the name has no extension. */
function withExtension(written: string): string {
  return written.split("/").pop()!.includes(".") ? written : `${written}.tex`;
}

/** Finds what a build of a root of the project builds alone: the `\include` path the editor focuses, else undefined. */
export type IncludeOnlyTarget = (project: ReadyProject, root: string) => Promise<string | undefined>;

export class IncludeOnlyState {
  // Off by default and kept in memory only: a restart builds the whole document again.
  private readonly on = new Set<string>();

  constructor(private readonly deps: IncludeOnlyDeps) {}

  isOn(projectFolder: string): boolean {
    return this.on.has(projectFolder);
  }

  set(projectFolder: string, on: boolean): void {
    if (on) { this.on.add(projectFolder); } else { this.on.delete(projectFolder); }
  }

  /** The preview's toggle: present only when the root's sources `\include` the focused file. */
  async option(project: ReadyProject, root: string, focusedFile: string): Promise<BuildOptions["includeOnly"]> {
    const written = await this.includedAs(project, root, focusedFile);
    return written === undefined ? undefined : { file: withExtension(written).replace(/^\.\//, ""), on: this.isOn(project.folder) };
  }

  /** The `\include` path to pass to `\includeonly` while the toggle is on, else undefined. */
  async target(project: ReadyProject, root: string, focusedFile: string): Promise<string | undefined> {
    return this.isOn(project.folder) ? this.includedAs(project, root, focusedFile) : undefined;
  }

  // The path exactly as written in the `\include`, because `\includeonly` matches it literally.
  private async includedAs(project: ReadyProject, root: string, focusedFile: string): Promise<string | undefined> {
    if (project.settings.format !== "latex") { return undefined; }
    const tree = await readLatexProjectSources(root, this.deps.readerFor(project.folder));
    for (const { facts } of tree.files) {
      for (const include of facts.includes) {
        if (include.command !== "include" || !SAFE_PATH.test(include.path)) { continue; }
        if (withExtension(include.path).replace(/^\.\//, "") === focusedFile) { return include.path; }
      }
    }
    return undefined;
  }
}
