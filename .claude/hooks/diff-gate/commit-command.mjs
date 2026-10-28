// Detects a `git commit` in a Bash command line (PreToolUse mode). Pure: no I/O.
// Quotes are honoured, so `echo "git commit"` and commit messages that mention it do not match. Segments are split on
// `&&  ||  ;  |  &`, newlines and parentheses. `--amend` counts as a commit: the fix then lands in the amended commit.
import { isAbsolute, resolve } from "node:path";

const SEPARATORS = new Set(["&", "|", ";", "\n", "(", ")"]);

// Splits a command line into segments of unquoted-word tokens (quote characters removed).
export function splitSegments(command) {
  const segments = [];
  let tokens = [];
  let word = null;
  let quote = null;
  const endWord = () => {
    if (word !== null) tokens.push(word);
    word = null;
  };
  const endSegment = () => {
    endWord();
    if (tokens.length > 0) segments.push(tokens);
    tokens = [];
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < command.length) word += command[++i];
      else word += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      word ??= "";
    } else if (ch === "\\" && i + 1 < command.length) {
      word = (word ?? "") + command[++i];
    } else if (SEPARATORS.has(ch)) {
      endSegment();
    } else if (/\s/.test(ch)) {
      endWord();
    } else {
      word = (word ?? "") + ch;
    }
  }
  endSegment();
  return segments;
}

// Options of `git` that take a separate argument.
const GIT_OPTIONS_WITH_ARG = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

// Returns { dir } for the first `git commit` segment (dir: the directory the command runs it in, from `cd x &&` or `git -C x`),
// or null when the command has none.
export function detectCommit(command, cwd) {
  if (typeof command !== "string" || !/\bgit\b/.test(command) || !/\bcommit\b/.test(command)) return null;
  let dir = cwd;
  for (const tokens of splitSegments(command)) {
    let i = 0;
    while (i < tokens.length && /^[A-Za-z_]\w*=/.test(tokens[i])) i++;
    if (tokens[i] === "cd" && tokens[i + 1] !== undefined && !tokens[i + 1].startsWith("-") && !tokens[i + 1].startsWith("~") && !tokens[i + 1].includes("$")) {
      dir = isAbsolute(tokens[i + 1]) ? tokens[i + 1] : resolve(dir, tokens[i + 1]);
      continue;
    }
    if (tokens[i] !== "git") continue;
    let where = dir;
    for (i += 1; i < tokens.length && tokens[i].startsWith("-"); i++) {
      if (tokens[i] === "-C" && tokens[i + 1] !== undefined) where = isAbsolute(tokens[i + 1]) ? tokens[i + 1] : resolve(where, tokens[i + 1]);
      if (GIT_OPTIONS_WITH_ARG.has(tokens[i])) i++;
    }
    if (tokens[i] === "commit") return { dir: where };
  }
  return null;
}
