/** Chooses the files of a project folder that belong in an exported zip, by the build and tool path rules it shares. */

import { DEFAULT_BIBLIOGRAPHY } from "../projectFile.js";

// Compiler output and tool state; everything else in the folder is the user's.
const EXCLUDED = [
  /(^|\/)\.(?:git|svn|hg|labshelf)\//,
  /\.(?:aux|log|out|toc|fls|fdb_latexmk|bcf|blg|synctex\.gz|run\.xml)$/,
];

const ROOT_SOURCE = /^(.*)\.(?:tex|typ)$/;

/** Whether a path is compiler output or the state of a tool (VCS, LabShelf), which no copy of the project carries. */
export function isBuildOrToolPath(path: string): boolean {
  return EXCLUDED.some((rule) => rule.test(path));
}

/** The PDFs in `list` built from a root source next to them (`<root>.pdf` beside `<root>.tex|typ`). */
export function builtPdfPaths(list: readonly string[]): Set<string> {
  return new Set(list.flatMap((path) => {
    const base = ROOT_SOURCE.exec(path)?.[1];
    return base === undefined ? [] : [`${base}.pdf`];
  }));
}

/** The paths (relative, POSIX) to export, in input order. */
export function projectFiles(list: string[]): string[] {
  const builtPdfs = builtPdfPaths(list);
  return list.filter((path) => path !== DEFAULT_BIBLIOGRAPHY && !builtPdfs.has(path) && !isBuildOrToolPath(path));
}
