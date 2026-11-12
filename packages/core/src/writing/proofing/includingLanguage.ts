// The language of a LaTeX file that declares none because it is a part of a larger document: the language of the root that includes it.
import { removeComments } from "../../latex/index.js";
import { posixPathOps as paths } from "../../path/index.js";
import { detectDocumentLanguage, type DocumentLanguage } from "./language.js";

/** The project files a part's root is looked for in: project-relative posix paths. */
export interface ProjectTextFiles {
  list(): Promise<string[]>;
  read(path: string): Promise<string>;
}

const MAGIC_ROOT = /^[ \t]*%[ \t]*!TEX[ \t]+root[ \t]*=[ \t]*(\S[^\r\n]*?)[ \t]*$/im;
const SUBFILES_CLASS = /\\documentclass\s*\[([^\]]*)\]\s*\{\s*subfiles\s*\}/;
const DOCUMENT_CLASS = /\\documentclass\b/;
// \import and \subimport take a folder and a file; the rest take one path.
const INCLUDE = /\\(input|include|subfile|import|subimport|inputfrom|subinputfrom|includefrom|subincludefrom)(?![A-Za-z@])\s*\{([^{}]*)\}(?:\s*\{([^{}]*)\})?/g;
const MAX_DEPTH = 16;

/** The project-relative path `written` names from `fromFile`'s folder, `.tex` added to a name without an extension; undefined for an absolute path, a macro or one leaving the project. */
function resolveInclude(fromFile: string, written: string): string | undefined {
  const name = written.trim();
  if (name === "" || name.startsWith("/") || /^[A-Za-z]:/.test(name) || /[\\#]/.test(name)) return undefined;
  const resolved = paths.resolve(paths.dirname(fromFile), name);
  if (resolved === "." || resolved === ".." || resolved.startsWith("../")) return undefined;
  return paths.extname(resolved) === "" ? `${resolved}.tex` : resolved;
}

/** The files a root's text includes, each resolved against the root's folder (TeX's working folder) and the including file's folder. */
function includesOf(root: string, file: string, text: string): string[] {
  const found: string[] = [];
  for (const match of removeComments(text).matchAll(INCLUDE)) {
    const command = match[1]!;
    const twoArgs = match[3] !== undefined && /import|from/.test(command);
    const written = twoArgs ? `${match[2]!.trim().replace(/\/?$/, "/")}${match[3]!.trim()}` : match[2]!;
    for (const from of [root, file]) {
      const path = resolveInclude(from, written);
      if (path !== undefined && !found.includes(path)) found.push(path);
    }
  }
  return found;
}

/** Whether `target` is in the include tree of `root`. */
function includes(root: string, target: string, texts: ReadonlyMap<string, string>): boolean {
  const seen = new Set([root]);
  let level = [root];
  for (let depth = 0; depth < MAX_DEPTH && level.length > 0; depth++) {
    const next: string[] = [];
    for (const file of level) {
      for (const included of includesOf(root, file, texts.get(file) ?? "")) {
        if (included === target) return true;
        if (!seen.has(included) && texts.has(included)) { seen.add(included); next.push(included); }
      }
    }
    level = next;
  }
  return false;
}

/** The root a part names itself: `% !TEX root = …`, else the option of `\documentclass[…]{subfiles}`. */
function namedRoot(path: string, text: string): string | undefined {
  const written = MAGIC_ROOT.exec(text)?.[1] ?? SUBFILES_CLASS.exec(removeComments(text))?.[1];
  return written === undefined ? undefined : resolveInclude(path, written);
}

async function readOrUndefined(files: ProjectTextFiles, path: string): Promise<string | undefined> {
  try { return await files.read(path); } catch { return undefined; }
}

/**
 * The language a LaTeX part inherits: the root it names (`% !TEX root`, a subfiles class option) when that root declares one, else
 * the first project file with `\documentclass` and a declared language whose `\input`, `\include`, `\subfile` or `\import` tree
 * reaches `path`. Null when no root declares a language. Unreadable files are skipped.
 */
export async function findIncludingLanguage(path: string, text: string, files: ProjectTextFiles): Promise<DocumentLanguage | null> {
  const named = namedRoot(path, text);
  if (named !== undefined && named !== path) {
    const rootText = await readOrUndefined(files, named);
    const language = rootText === undefined ? undefined : detectDocumentLanguage("latex", rootText);
    if (language?.declared) return language;
  }
  const paths = (await files.list()).filter((file) => file.endsWith(".tex") && file !== path);
  const texts = new Map<string, string>();
  for (const [file, content] of await Promise.all(paths.map(async (file) => [file, await readOrUndefined(files, file)] as const))) {
    if (content !== undefined) texts.set(file, content);
  }
  for (const [root, rootText] of texts) {
    const code = removeComments(rootText);
    if (!DOCUMENT_CLASS.test(code) || SUBFILES_CLASS.test(code)) continue;
    const language = detectDocumentLanguage("latex", rootText);
    if (language.declared && includes(root, path, texts)) return language;
  }
  return null;
}
