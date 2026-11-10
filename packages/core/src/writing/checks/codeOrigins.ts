/** Reads the code listings of a project's sources and lists those that are not fresh. */
// CONTRACT: documents/contracts/library-format.md#code-listings
import { describeAnchor, resolveCodeLinks, type CodeLinkSource } from "../codeLinks/index.js";
import { readOptionalText, type ProjectReadContext } from "../project/index.js";
import type { ChecklistSource } from "./checklist.js";

/** A manuscript listing whose copy differs from its code file, or whose code is gone; fresh and unreadable listings are not listed. */
export interface CodeOrigin {
  file: string;
  /** Zero-based line of the opening comment. */
  line: number;
  /** The code file, relative to the project folder. */
  path: string;
  /** What the listing copies, in words: `fit_model in fit.py`. */
  anchor: string;
  state: "stale" | "diverged" | "both" | "missing";
}

/**
 * Code files read through the file-system port, for hosts whose project folders are relative to a library root (the browser):
 * a path that climbs out of that root cannot be read here and throws, so its listing gets no state.
 */
export function createLibraryCodeSource({ fs, paths }: Pick<ProjectReadContext, "fs" | "paths">, folder: string): CodeLinkSource {
  return {
    read: async (path) => {
      const file = paths.resolve(folder, ...path.split("/"));
      if (file === ".." || file.startsWith("../") || paths.isAbsolute(file)) { throw new Error(`${path} is outside the library folder`); }
      return readOptionalText(fs, file);
    },
  };
}

/** @returns the stale, diverged, both and missing listings of the sources, in source order */
export async function readCodeOrigins(sources: readonly ChecklistSource[], code: CodeLinkSource): Promise<CodeOrigin[]> {
  const origins: CodeOrigin[] = [];
  for (const source of sources) {
    for (const { link, state } of await resolveCodeLinks(source.format, source.text, code)) {
      if (state === undefined || state === "fresh") { continue; }
      origins.push({ file: source.path, line: link.beginLine, path: link.path, anchor: describeAnchor(link.path, link.anchor), state });
    }
  }
  return origins;
}
