/** Finds a paper's main TeX file and flattens its \input, \include and \subfile tree into one text. */
import { removeComments } from "../latex/index.js";

const MAIN_NAME = /(?:^|\/)(?:ms|main|paper)\.tex$/i;
const INCLUDE = /\\(?:input|include|subfile)\s*\{([^{}]*)\}/g;

const sizeOf = (files: Map<string, string>, path: string): number => files.get(path)?.length ?? 0;

/** The one file with both \documentclass and \begin{document}; among several, the one named like ms, main or paper first, else the largest. */
export function findMainFile(files: Map<string, string>): string | undefined {
  const documents = [...files].filter(([, text]) => {
    const clean = removeComments(text);
    return clean.includes("\\documentclass") && clean.includes("\\begin{document}");
  }).map(([path]) => path);
  const named = documents.filter((path) => MAIN_NAME.test(path));
  const pool = named.length > 0 ? named : documents;
  return pool.reduce<string | undefined>((best, path) => (best === undefined || sizeOf(files, path) > sizeOf(files, best) ? path : best), undefined);
}

const folderOf = (path: string): string => path.slice(0, path.lastIndexOf("/") + 1);

/** `base` plus a relative `name`, with `.` and `..` segments resolved. */
function resolvePath(base: string, name: string): string {
  const parts: string[] = [];
  for (const part of `${base}${name}`.split("/")) {
    if (part === "..") { parts.pop(); } else if (part !== "." && part !== "") { parts.push(part); }
  }
  return parts.join("/");
}

/** The main file's text, comments removed, with each include replaced by its file; a missing file's command stays, a file already being expanded is not entered again, which ends a cycle. */
export function flattenSource(files: Map<string, string>, main: string): string {
  const root = folderOf(main);
  // The files being expanded, from the main file down; a cycle is the second visit of one of them.
  const visited = new Set<string>();
  const expand = (path: string): string => {
    visited.add(path);
    const text = removeComments(files.get(path) ?? "").replace(INCLUDE, (command: string, name: string) => {
      const target = [resolvePath(root, name.trim()), resolvePath(root, `${name.trim()}.tex`)].find((candidate) => files.has(candidate));
      if (target === undefined || visited.has(target)) { return command; }
      return expand(target);
    });
    visited.delete(path);
    return text;
  };
  return files.has(main) ? expand(main) : "";
}
