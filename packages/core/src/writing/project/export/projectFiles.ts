/** Chooses the files of a project folder that belong in an exported zip. */

import { DEFAULT_BIBLIOGRAPHY } from "../projectFile.js";

// Compiler output and tool state; everything else in the folder is the user's.
const EXCLUDED = [
  /(^|\/)\.(?:git|svn|hg|labshelf)\//,
  /\.(?:aux|log|out|toc|fls|fdb_latexmk|bcf|blg|synctex\.gz|run\.xml)$/,
];

const ROOT_SOURCE = /^(.*)\.(?:tex|typ)$/;

/** The paths (relative, POSIX) to export, in input order. */
export function projectFiles(list: string[]): string[] {
  const builtPdfs = new Set(list.flatMap((path) => {
    const base = ROOT_SOURCE.exec(path)?.[1];
    return base === undefined ? [] : [`${base}.pdf`];
  }));
  return list.filter((path) =>
    path !== DEFAULT_BIBLIOGRAPHY && !builtPdfs.has(path) && !EXCLUDED.some((rule) => rule.test(path)));
}
