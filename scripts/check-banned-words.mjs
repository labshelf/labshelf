// Fails when package sources use a banned word: a grab-bag or history file name, a comment tag outside the four allowed, or an emoji.
// Usage: node scripts/check-banned-words.mjs [file...] — with no files, scans every packages/*/src and packages/*/__tests__.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = /\.(ts|tsx|css|mjs)$/;

const GRAB_BAG = new Set(["util", "utils", "helpers", "misc", "common", "manager"]);
// TRAP: "new" is left out because it names a domain action (newPaper, newIds), not a version.
const HISTORY = new Set(["old", "legacy", "v2", "deprecated", "compat"]);
const TAG = /^\s*(\/\/|\/?\*+)\s*(TODO|FIXME|HACK|XXX|NOTE|WARNING|IMPORTANT|BUG)\b/;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2B55}]/u;

const nameWords = (rel) =>
  basename(rel)
    .replace(/\..*$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[\s_-]+/);

export function findBannedWords(rel, text) {
  const problems = [];
  const words = nameWords(rel);
  // TRAP: "UndoManager" is the Yjs class name, not a grab-bag.
  if (words.some((word, i) => GRAB_BAG.has(word) && !(word === "manager" && words[i - 1] === "undo"))) {
    problems.push(`${rel}: grab-bag file name. Name the file after its one responsibility.`);
  }
  if (words.some((word) => HISTORY.has(word))) problems.push(`${rel}: history word in the file name. Name what the code is, not its version.`);
  // Tests may hold emoji as data, e.g. to pin terminal cell widths.
  const checksEmoji = !rel.includes("/__tests__/");
  text.split("\n").forEach((line, i) => {
    const tag = line.match(TAG);
    if (tag) problems.push(`${rel}:${i + 1}: ${tag[2]} tag. Comments carry only TRAP:, INVARIANT:, PLATFORM: or CONTRACT:.`);
    if (checksEmoji && EMOJI.test(line)) problems.push(`${rel}:${i + 1}: emoji. Icons come from the core icon set as inline SVG.`);
  });
  return problems;
}

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (SOURCE.test(entry.name)) out.push(path);
  }
  return out;
}

function allPackageSources() {
  const files = [];
  for (const pkg of readdirSync(join(root, "packages"))) {
    for (const part of ["src", "__tests__"]) {
      const dir = join(root, "packages", pkg, part);
      if (existsSync(dir)) sourceFiles(dir, files);
    }
  }
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const files = args.length > 0 ? args.map((file) => resolve(file)) : allPackageSources();
  const problems = files.flatMap((file) => findBannedWords(relative(root, file), readFileSync(file, "utf8")));
  for (const problem of problems) console.error(problem);
  if (args.length === 0) console.log(`banned words: ${problems.length} problems in ${files.length} files`);
  process.exit(problems.length > 0 ? 1 : 0);
}
