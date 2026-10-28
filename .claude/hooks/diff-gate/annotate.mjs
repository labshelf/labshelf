// Extra facts about a violation that the variant policies (policy.mjs) and the auto-fix (autofix.mjs) decide on.
// Everything here is plain text analysis of the file at the checked revision; none of it needs a model.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./checks.mjs";

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const DECL = /^\s*export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:const\s+enum|const|let|var|function\*?|class|type|interface|enum|namespace)\s+/;
const DECL_WORD = /^\s*export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const\s+enum|const|let|var|function\*?|class|type|interface|enum|namespace)\b/;
const REEXPORT = /^\s*export\s+(?:type\s*)?(?:\*|\{[^}]*\}\s*from)|^\s*\}\s*from\s/;
const LIST_EXPORT = /^\s*export\s+(?:type\s*)?\{[^}]*\}\s*;?\s*$/;

// Text of a source line with string contents and comments blanked out, so word counts only see code.
export function codeLines(text) {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlock.split("\n").map((line) => line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, blankString).replace(/\/\/.*$/, ""));
}

// Blanks a string literal's contents; a template literal keeps its `${...}` expressions (code that can reference a symbol).
function blankString(m) {
  const inner = m.slice(1, -1);
  const body = m[0] === "`" ? inner.replace(/\$\{[^}]*\}|[^$]|\$/g, (part) => (part.startsWith("${") ? part : " ")) : " ".repeat(inner.length);
  return `${m[0]}${body}${m[0]}`;
}

// Last line (0-based) of the statement that starts at `from`: brace/paren matching, ends at depth 0 on a line that closes or ends with ;
function statementEnd(lines, from) {
  let depth = 0;
  let opened = false;
  for (let i = from; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{" || ch === "(" || ch === "[") {
        depth++;
        opened = true;
      } else if (ch === "}" || ch === ")" || ch === "]") depth--;
    }
    if (depth <= 0 && (opened || /[;]\s*$/.test(lines[i]) || i === from)) {
      if (depth <= 0 && (/[;}]\s*$/.test(lines[i].trimEnd()) || !opened)) return i;
    }
  }
  return lines.length - 1;
}

// Describes an unused export at file:line (1-based).
export function describeExport(root, file, line, name) {
  let text;
  try {
    text = readFileSync(join(root, file), "utf8");
  } catch {
    return {};
  }
  const raw = text.split("\n");
  const code = codeLines(text);
  const declLine = raw[line - 1] ?? "";
  const info = { name, declKind: null, selfRefs: 0, barrel: /(^|\/)index\.[mc]?[jt]sx?$/.test(file), reexport: REEXPORT.test(declLine), listExport: LIST_EXPORT.test(declLine), simpleDecl: false };
  const m = declLine.match(DECL_WORD);
  if (m) {
    info.simpleDecl = !/^\s*export\s+default\b/.test(declLine) && new RegExp(`\\b${esc(name)}\\b`).test(declLine);
    info.declKind = (declLine.match(/\b(const\s+enum|const|let|var|function|class|type|interface|enum|namespace)\b/) ?? [])[1] ?? null;
  } else if (info.listExport) info.declKind = "list";
  // references outside the declaration statement itself
  const span = info.simpleDecl ? [line - 1, statementEnd(code, line - 1)] : [line - 1, line - 1];
  const re = new RegExp(`(?<![\\w$.])${esc(name)}(?![\\w$])`, "g");
  for (let i = 0; i < code.length; i++) {
    if (i >= span[0] && i <= span[1]) continue;
    info.selfRefs += (code[i].match(re) ?? []).length;
  }
  return info;
}

const CONFIG_GLOBS = ["package.json", "*.config.*", "**/*.config.*", "manifest*.json", "**/manifest*.json", "*.html", "**/*.html", "scripts/**", "tools/**", "esbuild*", "**/esbuild*", "**/vite*", "**/webpack*", "knip.json", "scripts/lint/knip.json"];
const GENERIC = new Set(["index", "main", "entry", "extension", "app", "cli", "worker", "background", "content", "popup"]);

// True when a build config, manifest, html page or script names the file (an entry point knip cannot see through config).
export async function configReferences(root, file) {
  const stem = file.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
  const parent = file.split("/").slice(-2, -1)[0] ?? "";
  const needle = GENERIC.has(stem) ? `${parent}/${stem}` : stem;
  const pattern = `(^|[^A-Za-z0-9_])${esc(needle)}(\\.(ts|tsx|js|mjs|cjs|css))?([^A-Za-z0-9_]|$)`;
  const out = await run("git", ["grep", "--untracked", "-l", "-E", "-I", pattern, "--", ...CONFIG_GLOBS.map((g) => `:(glob)${g}`), `:(exclude)${file}`, ":(exclude)*.md"], { cwd: root, timeoutMs: 20_000 });
  const hits = out.stdout.split("\n").filter(Boolean).filter((f) => !/(^|\/)(node_modules|__tests__)\//.test(f) && !/^scripts\/(lint|docs)\//.test(f));
  return hits.slice(0, 3);
}

// Which tracked source rule a sourceRules message is about.
export function ruleClass(message) {
  if (message.startsWith("adds an eslint-disable")) return "eslint-disable";
  if (message.startsWith("adds a @ts-ignore")) return "ts-ignore";
  if (message.startsWith("skips a test")) return "test-skip";
  if (message.startsWith("adds commented-out")) return "commented-code";
  return "other";
}
