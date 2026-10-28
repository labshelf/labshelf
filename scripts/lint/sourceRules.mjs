// Checks the source rules on changed files: size, history language, suppressions, commented-out code, hard-coded CSS values, test mirrors, headers, banned words and CONTRACT anchors.
// Most rules are ratchets: they compare a file with its version at the base revision and only complain when a count grew.
// Usage: node scripts/lint/sourceRules.mjs [--base <rev>] [file...] — base defaults to HEAD; with no files, checks every file changed against the base.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { slugify } from "../docs/doc.mjs";
import { findBannedWords } from "./bannedWords.mjs";

const SOURCE_LIMIT = 400;
const TEST_LIMIT = 500;

const TEST_FILE = /^packages\/[^/]+\/__tests__\/.*\.ts$/;
const SOURCE_FILE = /^packages\/[^/]+\/src\/.*\.(ts|tsx|css)$/;
const BUILD_FILE = /^packages\/[^/]+\/build\/.*\.mjs$/;
const APP_CSS = /^packages\/(vscode|browser|terminal)\/src\/.*\.css$/;
const NEW_TEST = /^packages\/[^/]+\/__tests__\/.*\.test\.tsx?$/;
const DOC_FILE = /^(documents\/.*\.md|README\.md)$/;

const HISTORY_WORDS =
  /no longer|previously|used to|legacy|formerly|was replaced|were replaced|backward[- ]compat|deprecated|instead of the old|refactored to|changed from|now (uses|keeps|has|is|does|returns|reads|writes)|@depends|@dependents|@usedBy/i;
// "legacy build" is the name of a pdf.js distribution, not history.
const PDFJS_BUILD = /legacy[/ ]build/i;
const COMMENT_LINE = /^\s*(\/\/|\/?\*)/;
const TS_SUPPRESSION = /@ts-(ignore|expect-error)\s*(\*\/)?\s*$/;
const ESLINT_SUPPRESSION = /eslint-disable(-next-line|-line)?/;
const TEST_SKIP = /\.skip\(|xit\(/;
const EMPTY_CATCH = /catch\s*\([^)]*\)\s*\{\s*\}/g;
const COMMENTED_CODE = /^\s*\/\/\s*(const|let|var|return|import|export|await|if\s*\(|for\s*\(|[A-Za-z_$.]+\(.*\);\s*$|\}\s*$)/;
const CSS_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(|\b[0-9.]+(px|rem|em)\b|font-family:[^;]*[^)];/g;
// The tag is written in two parts so this file never contains the string it scans for.
const CONTRACT_REF = new RegExp("CONTRACT" + ": documents/contracts/[A-Za-z0-9_-]+\\.md#[A-Za-z0-9-]+", "g");

const lines = (text) => text.split("\n");
const countLines = (text) => lines(text).length - 1;
const countMatching = (text, pattern) => lines(text).filter((line) => pattern.test(line)).length;
const grew = (now, was) => now > was;

export function codeScope(rel) {
  return SOURCE_FILE.test(rel) || TEST_FILE.test(rel);
}

function historyScope(rel) {
  if (rel.startsWith("documents/plans/")) return null;
  if (DOC_FILE.test(rel)) return "doc";
  return codeScope(rel) ? "code" : null;
}

export function sizeProblems(rel, text, headText) {
  const limit = TEST_FILE.test(rel) ? TEST_LIMIT : SOURCE_FILE.test(rel) || BUILD_FILE.test(rel) ? SOURCE_LIMIT : 0;
  if (limit === 0) return [];
  const count = countLines(text);
  if (count > limit && (headText === null || count > countLines(headText))) {
    return [`${rel} has ${count} lines (limit ${limit}). Split it by responsibility.`];
  }
  return [];
}

export function planSizeProblems(rel, text) {
  let limit = 0;
  let hint = "";
  if (/^documents\/plans\/[^/]+\/plan\.md$/.test(rel)) {
    limit = 12000;
    hint = "Split it: move detail into sessions/ or research/.";
  } else if (/^documents\/plans\/[^/]+\/sessions\/[^/]+\.md$/.test(rel)) {
    limit = 6000;
    hint = "Split the session or move context into research/.";
  }
  const chars = [...text].length;
  return limit > 0 && chars > limit ? [`${rel} has ${chars} characters (limit ${limit}). ${hint}`] : [];
}

export function historyProblems(rel, text, headText) {
  const scope = historyScope(rel);
  if (scope === null) return [];
  const count = (source) =>
    lines(source).filter((line) => (scope === "code" ? COMMENT_LINE.test(line) : true) && !PDFJS_BUILD.test(line) && HISTORY_WORDS.test(line)).length;
  if (!grew(count(text), headText === null ? 0 : count(headText))) return [];
  const hits = lines(text)
    .map((line, i) => `${i + 1}:${line}`)
    .filter((line) => HISTORY_WORDS.test(line) && !PDFJS_BUILD.test(line))
    .slice(0, 5)
    .join("\n");
  return [`${rel} gained history language or dependency lists. Describe what is, without history, and drop @depends/@usedBy:\n${hits}`];
}

export function suppressionProblems(rel, text, headText) {
  if (!codeScope(rel)) return [];
  const before = headText ?? "";
  const problems = [];
  const ratchet = (pattern, message) => {
    if (grew(countMatching(text, pattern), countMatching(before, pattern))) problems.push(`${rel} ${message}`);
  };
  ratchet(TS_SUPPRESSION, "adds a @ts-ignore or @ts-expect-error with no reason. Add a reason after it, or fix the type error.");
  ratchet(ESLINT_SUPPRESSION, "adds an eslint-disable comment. Fix the lint issue instead of suppressing it.");
  ratchet(TEST_SKIP, "skips a test (.skip( or xit(). Fix or delete the test, do not leave it skipped.");
  const catches = (source) => (source.match(EMPTY_CATCH) ?? []).length;
  if (grew(catches(text), catches(before))) problems.push(`${rel} adds an empty catch block. Log or surface the error, never swallow it silently.`);
  return problems;
}

export function commentedCodeProblems(rel, text, headText) {
  if (!codeScope(rel)) return [];
  return grew(countMatching(text, COMMENTED_CODE), countMatching(headText ?? "", COMMENTED_CODE))
    ? [`${rel} adds commented-out code. Delete it; git keeps the history.`]
    : [];
}

export function cssLiteralProblems(rel, text, headText) {
  if (!APP_CSS.test(rel)) return [];
  const count = (source) => lines(source).reduce((sum, line) => sum + (line.match(CSS_LITERAL) ?? []).length, 0);
  return grew(count(text), count(headText ?? "")) ? [`${rel} adds a hard-coded colour, size or font. Use a core --ls-* design token.`] : [];
}

// The source a test mirrors: __tests__/a/b.test.ts covers src/a/b.ts, .tsx, .css, src/a/b/index.ts or the folder src/a/b/.
function mirrorOf(rel) {
  const pkgDir = rel.slice(0, rel.indexOf("/__tests__/"));
  const base = rel.slice(rel.indexOf("/__tests__/") + "/__tests__/".length).replace(/\.test\.tsx?$/, "");
  return { pkgDir, base, stem: `${pkgDir}/src/${base}` };
}

export function mirroredSourceExists(rel, exists) {
  const { stem } = mirrorOf(rel);
  return [`${stem}.ts`, `${stem}.tsx`, `${stem}.css`, `${stem}/index.ts`, stem].some(exists);
}

export function testMirrorProblems(rel, headText, exists) {
  if (!NEW_TEST.test(rel) || headText !== null) return [];
  if (mirroredSourceExists(rel, exists)) return [];
  const { pkgDir, base } = mirrorOf(rel);
  return [`${rel} has no source file at ${pkgDir}/src/${base}.ts or folder ${pkgDir}/src/${base}/. Name the test after the file or folder it tests.`];
}

export function deletedTestProblems(deletedPaths, exists) {
  return deletedPaths
    .filter((path) => /^packages\/[^/]+\/__tests__\/.*\.test\.ts$/.test(path) && mirroredSourceExists(path, exists))
    .map((path) => `${path} was deleted but its code still exists; delete the test only together with the code.`);
}

export function headerProblems(rel, text, headText) {
  if (headText !== null || !(SOURCE_FILE.test(rel) || BUILD_FILE.test(rel))) return [];
  const first = lines(text).find((line) => line.trim() !== "");
  if (first === undefined || /^\s*(\/\/|\/\*)/.test(first)) return [];
  return [`${rel}: new source file has no header comment. Line 1 describes what the file holds, e.g. "// Parses and checks the project file.".`];
}

export function contractProblems(rel, text, headText, readContract) {
  const known = new Map();
  for (const line of lines(headText ?? "")) known.set(line, (known.get(line) ?? 0) + 1);
  const added = lines(text).filter((line) => {
    const left = known.get(line) ?? 0;
    if (left > 0) known.set(line, left - 1);
    return left === 0;
  });
  const problems = [];
  for (const hit of added.join("\n").match(CONTRACT_REF) ?? []) {
    const [docName, anchor] = hit.slice(hit.lastIndexOf("/") + 1).split("#");
    const doc = readContract(docName);
    if (doc === null) {
      problems.push(`${rel}: CONTRACT references documents/contracts/${docName} which does not exist.`);
      continue;
    }
    const headings = lines(doc)
      .map((line) => line.match(/^#{1,6}\s+(.*)$/))
      .filter(Boolean)
      .map((match) => slugify(match[1]));
    if (!headings.includes(anchor)) problems.push(`${rel}: CONTRACT anchor '#${anchor}' not found in documents/contracts/${docName}.`);
  }
  return problems;
}

// ctx: { exists(relPath) -> boolean, readContract(fileName) -> string | null }
export function checkFile(rel, text, headText, ctx) {
  return [
    ...sizeProblems(rel, text, headText),
    ...planSizeProblems(rel, text),
    ...historyProblems(rel, text, headText),
    ...suppressionProblems(rel, text, headText),
    ...(codeScope(rel) ? findBannedWords(rel, text) : []),
    ...commentedCodeProblems(rel, text, headText),
    ...cssLiteralProblems(rel, text, headText),
    ...testMirrorProblems(rel, headText, ctx.exists),
    ...headerProblems(rel, text, headText),
    ...contractProblems(rel, text, headText, ctx.readContract),
  ];
}

function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

const gitLines = (output) => (output ?? "").split("\n").filter(Boolean);

function changedFiles(gitRoot, base) {
  const changed = gitLines(git(gitRoot, ["diff", "--name-only", "--no-renames", "--diff-filter=AM", base]));
  const untracked = gitLines(git(gitRoot, ["ls-files", "--others", "--exclude-standard"]));
  return [...new Set([...changed, ...untracked])];
}

function deletedFiles(gitRoot, base) {
  return gitLines(git(gitRoot, ["diff", "--name-only", "--diff-filter=D", base, "--", "packages/*/__tests__/*.ts"]));
}

export function parseArgs(argv) {
  let base = "HEAD";
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") base = argv[++i];
    else files.push(argv[i]);
  }
  return { base, files };
}

function run(argv) {
  const { base, files } = parseArgs(argv);
  const top = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  if (top === null) {
    console.error("sourceRules: not inside a git repository.");
    return 1;
  }
  const gitRoot = realpathSync(top.trim());
  const ctx = {
    exists: (path) => existsSync(resolve(gitRoot, path)),
    readContract: (name) => {
      const path = resolve(gitRoot, "documents/contracts", name);
      return existsSync(path) ? readFileSync(path, "utf8") : null;
    },
  };
  const absolute = (file) => {
    const path = resolve(file);
    return existsSync(path) && statSync(path).isFile() ? relative(gitRoot, realpathSync(path)) : null;
  };
  const targets = files.length > 0 ? files.map(absolute).filter((rel) => rel !== null) : changedFiles(gitRoot, base);
  const problems = deletedTestProblems(deletedFiles(gitRoot, base), ctx.exists);
  let checked = 0;
  for (const rel of targets) {
    if (rel.startsWith("..") || !ctx.exists(rel) || !statSync(resolve(gitRoot, rel)).isFile()) continue;
    checked++;
    problems.push(...checkFile(rel, readFileSync(resolve(gitRoot, rel), "utf8"), git(gitRoot, ["show", `${base}:${rel}`]), ctx));
  }
  for (const problem of problems) console.error(problem);
  if (files.length === 0) console.log(`source rules: ${problems.length} problems in ${checked} files`);
  return problems.length > 0 ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(run(process.argv.slice(2)));
