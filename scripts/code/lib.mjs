// Path rules and text helpers for the code-facts database: where it lives, its build lock, which module and runtime a file belongs
// to, file headers, comment tags, test mirrors, name splitting and the full-text query built from the user's words.
import { openSync, readFileSync, rmSync, writeSync, closeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FACTS_DIR = join(ROOT, ".code-facts");
export const DB_PATH = join(FACTS_DIR, "facts.db");
export const LOCK_PATH = join(FACTS_DIR, "build.lock");
export const SCHEMA_VERSION = "1";
export const PACKAGES = ["core", "vscode", "browser", "terminal"];

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

/** Takes the lock file at `path` for this process; returns its release function, or null while a live process holds it. */
export function acquireLock(path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => rmSync(path, { force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = Number(readFileSync(path, "utf8"));
      if (owner && isAlive(owner)) return null;
      rmSync(path, { force: true });
    }
  }
  return null;
}

// ---------- modules and runtimes ----------
// INVARIANT: paths are repo-relative with "/" and start with packages/<pkg>/src, so segment 3 is the domain.
const SRC_DEPTH = 3;
// The same rule as scripts/lint/modules.mjs: runtime folders are part of the enclosing module.
const RUNTIME_FOLDERS = new Set(["node", "dom", "worker", "webview"]);
const dirOf = (path) => path.slice(0, path.lastIndexOf("/"));

export function ownerOf(folder) {
  let owner = folder;
  while (owner.split("/").length > SRC_DEPTH && RUNTIME_FOLDERS.has(owner.slice(owner.lastIndexOf("/") + 1))) owner = dirOf(owner);
  return owner;
}
export const moduleOf = (path) => ownerOf(dirOf(path));
export const domainOf = (path) => {
  const parts = path.split("/");
  return parts.length > SRC_DEPTH + 1 ? parts[SRC_DEPTH] : "(root)";
};

export function runtimeOf(path) {
  const segs = path.split("/");
  const pkg = segs[1];
  const inner = segs.slice(SRC_DEPTH, -1);
  const folder = ["worker", "webview", "node", "dom"].find((name) => inner.includes(name));
  if (folder) return folder;
  if (pkg === "core") return "neutral";
  if (pkg === "terminal") return "node";
  if (pkg === "vscode") {
    if (path.endsWith("src/extension.ts")) return "node";
    if (path.endsWith("webviewGlobals.d.ts")) return "webview";
    return "vscode-host";
  }
  if (segs[SRC_DEPTH] === "background") return "worker";
  if (segs[SRC_DEPTH] === "content") return "content-script";
  return "dom";
}

/** Candidate source files a test mirrors: packages/<pkg>/__tests__/<p>.test.ts tests packages/<pkg>/src/<p>.ts. */
export function mirrorSourcesOf(testPath) {
  const match = /^(packages\/[^/]+)\/__tests__\/(.+)\.test\.tsx?$/.exec(testPath);
  return match ? [`${match[1]}/src/${match[2]}.ts`, `${match[1]}/src/${match[2]}.tsx`] : [];
}

// ---------- text ----------
const clean = (text) => text.replace(/\s+/g, " ").trim();

/** The first sentences of `text` that fit in `max` characters; a single longer sentence is cut with an ellipsis. */
export function firstSentences(text, max = 300) {
  const flat = clean(text);
  if (flat.length <= max) return flat;
  const head = flat.slice(0, max);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("; "));
  return end > 0 ? head.slice(0, end + 1) : `${head.slice(0, max - 1)}…`;
}

/** The leading comment block of a source file (line comments or one block comment), flattened and capped. */
export function headerOf(text) {
  const lines = text.split("\n");
  let i = 0;
  if (lines[0]?.startsWith("#!")) i++;
  while (i < lines.length && lines[i].trim() === "") i++;
  const out = [];
  if (/^\s*\/\*/.test(lines[i] ?? "")) {
    for (; i < lines.length; i++) {
      const done = lines[i].includes("*/");
      out.push(lines[i].replace(/^\s*\/\*+/, "").replace(/\*+\/.*$/, "").replace(/^\s*\*\s?/, ""));
      if (done) break;
    }
  } else {
    for (; i < lines.length && /^\s*\/\//.test(lines[i]); i++) out.push(lines[i].replace(/^\s*\/\/+\s?/, ""));
  }
  return firstSentences(out.join(" "));
}

const TAG_START = /^\s*(?:\/\/+|\/\*+|\*)\s*(TRAP|INVARIANT|PLATFORM|CONTRACT):\s*(.*)$/;
const LINE_COMMENT = /^\s*\/\/+\s?(.*)$/;

/** Comments tagged TRAP:, INVARIANT:, PLATFORM: or CONTRACT:, with the untagged comment lines that continue them. */
export function tagsOf(text) {
  const lines = text.split("\n");
  const tags = [];
  for (let i = 0; i < lines.length; i++) {
    const start = TAG_START.exec(lines[i]);
    if (!start) continue;
    const isLine = /^\s*\/\//.test(lines[i]);
    const parts = [start[2].replace(/\*+\/\s*$/, "")];
    for (let j = i + 1; isLine && j < lines.length; j++) {
      const next = LINE_COMMENT.exec(lines[j]);
      if (!next || TAG_START.test(lines[j]) || next[1].trim() === "") break;
      parts.push(next[1]);
    }
    tags.push({ line: i + 1, tag: start[1], text: firstSentences(parts.join(" ")) });
  }
  return tags;
}

/** A name or path as lower-case words: `hostPacer` → `host pacer`, `a/pathOps.ts` → `a path ops ts`. */
export const splitWords = (name) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-zA-Z])([0-9])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join(" ");

const STOP_WORDS = new Set("a an and are as at be by for from in into is it of on or per the to with".split(" "));

/** An FTS5 query that ORs every word of `words`, so bm25 ranks rows by how many and how rare the matches are. */
export const ftsQuery = (words) =>
  [...new Set(splitWords(words).split(" ").filter((word) => word && !STOP_WORDS.has(word)))].map((word) => `"${word}"`).join(" OR ");

// ---------- clone fingerprints and signatures ----------
/** 32-bit FNV-1a hash of `text`. */
export const fnv = (text) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
};

/** Sorted unique hashes of every run of `size` consecutive tokens; a stream shorter than `size` is one shingle. */
export function shingleSet(toks, size = 4) {
  const set = new Set();
  for (let i = 0; i + size <= toks.length; i++) set.add(fnv(toks.slice(i, i + size).join(" ")));
  if (toks.length > 0 && toks.length < size) set.add(fnv(toks.join(" ")));
  return Uint32Array.from(set).sort();
}

/** Jaccard similarity of two sorted unique hash arrays. */
export function jaccard(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  let shared = 0;
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) [shared, i, j] = [shared + 1, i + 1, j + 1];
    else if (a[i] < b[j]) i++;
    else j++;
  }
  return shared / (a.length + b.length - shared);
}

/** A type as compared by `facts sig`: lower case, without spaces or a leading `readonly`. */
export const typeKey = (type) => type.replace(/\s+/g, "").replace(/^readonly(?=[a-z[(])/i, "").toLowerCase();

/** `text` split at commas outside <>, (), [] and {}: `Map<a, b>, c` → [`Map<a, b>`, `c`]. */
export function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if ("<([{".includes(char)) depth++;
    else if (">)]}".includes(char) && !(char === ">" && current.endsWith("="))) depth--;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  return [...parts, current].map((part) => part.trim()).filter(Boolean);
}

/** How many items of `wanted` occur in `have`, each item of `have` used once (multiset intersection size). */
export function multisetOverlap(wanted, have) {
  const left = new Map();
  for (const item of have) left.set(item, (left.get(item) ?? 0) + 1);
  let count = 0;
  for (const item of wanted) {
    if (!left.get(item)) continue;
    left.set(item, left.get(item) - 1);
    count++;
  }
  return count;
}

const MAX_UNIT_EMBED_CHARS = 900;

/**
 * The searchable text of a unit, as columns for the `facts fn` index and one string for its embedding: name words,
 * kind and visibility with the parameter and return types, called names, and comment, signature and string literals.
 */
export function unitSearchText(unit) {
  const name = splitWords(unit.owner ? `${unit.owner} ${unit.name}` : unit.name);
  const visibility = unit.exported ? "exported" : "private";
  const types = [unit.kind, visibility, ...unit.params, unit.returns].map(splitWords).join(" ");
  const calls = unit.calls.map(splitWords).join(" ");
  const about = unit.comment || unit.doc;
  const text = [about, unit.signature, unit.literals.join(" ")].filter(Boolean).join(" ");
  const embed = [
    `${name} (${unit.kind}, ${visibility}) ${unit.signature}`,
    about,
    unit.calls.length ? `calls: ${unit.calls.join(", ")}` : "",
    unit.literals.length ? `strings: ${unit.literals.join(" ")}` : "",
    unit.header,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_UNIT_EMBED_CHARS);
  return { name, types, calls, text, header: unit.header, embed };
}
