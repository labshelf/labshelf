// Reads a diff from git: which files changed against a base and which line ranges were added.
// Working-tree mode (no head) counts staged, unstaged and untracked (non-ignored) files; head mode compares two commits.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";

const MAX_BUFFER = 256 * 1024 * 1024;
const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024;

export function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: MAX_BUFFER });
  } catch {
    return null;
  }
}

export function repoRoot(dir) {
  const top = git(dir, ["rev-parse", "--show-toplevel"]);
  return top === null ? null : realpathSync(top.trim());
}

export function resolveRev(root, rev) {
  const out = git(root, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
  return out === null ? null : out.trim();
}

// Parses `git diff -U0` output into Map<path, { status: "A" | "M" | "D", ranges: [start, end][] }>.
export function parseDiff(text) {
  const files = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    const header = line.match(/^diff --git a\/(.*) b\/(.*)$/);
    if (header) {
      current = { status: "M", ranges: [] };
      files.set(header[2], current);
    } else if (current === null) {
      continue;
    } else if (line.startsWith("new file mode")) {
      current.status = "A";
    } else if (line.startsWith("deleted file mode")) {
      current.status = "D";
    } else {
      const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (hunk) {
        const start = Number(hunk[1]);
        const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
        if (count > 0) current.ranges.push([start, start + count - 1]);
      }
    }
  }
  return files;
}

function looksBinary(buffer) {
  return buffer.subarray(0, 8000).includes(0);
}

function untrackedPaths(root) {
  const out = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  return (out ?? "").split("\0").filter(Boolean);
}

function hashFiles(root, rels) {
  const hashes = new Map();
  const names = rels.filter((rel) => !rel.includes("\n"));
  try {
    const out = execFileSync("git", ["hash-object", "--stdin-paths"], { cwd: root, encoding: "utf8", input: names.join("\n"), stdio: ["pipe", "pipe", "ignore"], maxBuffer: MAX_BUFFER });
    out.split("\n").filter(Boolean).forEach((hash, i) => hashes.set(names[i], hash));
  } catch {
    // One unreadable file fails the whole batch: hash the files one by one and leave the unreadable ones out.
    for (const rel of names) {
      const hash = git(root, ["hash-object", "--", rel]);
      if (hash !== null) hashes.set(rel, hash.trim());
    }
  }
  return hashes;
}

// Map<path, content hash> of the untracked (non-ignored) files, used to tell files that were already there from files the session wrote.
export function untrackedHashes(root) {
  return hashFiles(root, untrackedPaths(root));
}

function untrackedFiles(root, skip) {
  const files = new Map();
  for (const rel of untrackedPaths(root)) {
    if (skip?.has(rel)) continue;
    try {
      const path = resolve(root, rel);
      const stat = statSync(path);
      if (!stat.isFile() || stat.size > MAX_UNTRACKED_BYTES) continue;
      const buffer = readFileSync(path);
      if (looksBinary(buffer)) continue;
      const count = buffer.toString("utf8").split("\n").length - (buffer.at(-1) === 10 ? 1 : 0);
      files.set(rel, { status: "A", ranges: count > 0 ? [[1, count]] : [] });
    } catch {
      // Vanished or unreadable between listing and reading: not part of the diff.
    }
  }
  return files;
}

// Returns Map<path, { status, ranges }>, or null when git cannot produce the diff (bad revision).
// `skipUntracked` (Set of paths) leaves out untracked files that were already there, unchanged, when the session started.
export function computeDiff(root, base, head, skipUntracked) {
  const args = ["-c", "core.quotepath=off", "diff", "-U0", "--no-renames", "--no-color", "--no-ext-diff", base];
  if (head) args.push(head);
  const text = git(root, [...args, "--"]);
  if (text === null) return null;
  const files = parseDiff(text);
  if (!head) for (const [rel, entry] of untrackedFiles(root, skipUntracked)) if (!files.has(rel)) files.set(rel, entry);
  return files;
}

export function isAdded(diff, rel, line) {
  const entry = diff.get(rel);
  return entry !== undefined && entry.status !== "D" && entry.ranges.some(([start, end]) => line >= start && line <= end);
}

export function overlapsAdded(diff, rel, start, end) {
  const entry = diff.get(rel);
  return entry !== undefined && entry.status !== "D" && entry.ranges.some(([from, to]) => start <= to && end >= from);
}

// Text of a file at a revision, or null when it did not exist there.
export function showAt(root, rev, rel) {
  return git(root, ["show", `${rev}:${rel}`]);
}
