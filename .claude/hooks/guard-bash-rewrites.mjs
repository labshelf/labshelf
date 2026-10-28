// Guard-bash rules for bulk rewrites: sed -i and perl -i that edit import paths or rename identifiers across files, and git mv of code.
import { basename } from 'node:path';
import { repoPath, skipOptions } from './guard-bash-shell.mjs';

const CODE_FILE = /\.(tsx?|mts|cts|jsx?|mjs|cjs)$/;
const CODE_MENTION = /\bpackages\b|\.(tsx?|jsx?|mjs|mts)\b/;
const IMPORT_EDIT = /\bfrom\s*\\?\[?['"]|\.m?[jt]sx?\\?['"]|\bimport\b|\brequire\s*\(/;
const SUBSTITUTION = /(?:^|[;{}\s])s(?=[^\w\s\\])(.)((?:\\.|(?!\1)[^\\])*)\1((?:\\.|(?!\1)[^\\])*)\1[a-z]*/g;
const WORD_EDGE = /\\[bB<>]/g;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const GIT_VALUED = new Set(['-C', '-c', '--git-dir', '--work-tree']);

const MOVE_HINT = 'Use: node scripts/codemods/moveFiles.mjs moves.tsv (lines: oldPath<TAB>newPath; run with --dry-run first); it git-mv\'s and rewrites every import.';

// Reads an in-place sed or perl command into { expr, files }, or null when the command edits nothing in place.
export function parseInPlace(words) {
  const [name, ...args] = words;
  const tool = basename(name ?? '');
  if (!['sed', 'gsed', 'perl'].includes(tool)) return null;
  const isPerl = tool === 'perl';
  const exprs = [];
  const rest = [];
  let inPlace = false;
  for (let j = 0; j < args.length; j++) {
    const arg = args[j];
    if (arg === '--') rest.push(...args.slice(j + 1));
    if (arg === '--') break;
    if (arg === '--in-place' || arg.startsWith('--in-place=')) inPlace = true;
    else if (arg === '--expression') exprs.push(args[++j] ?? '');
    else if (arg.startsWith('--expression=')) exprs.push(arg.slice('--expression='.length));
    else if (!isPerl && (arg === '-f' || arg === '--file')) j++;
    else if (/^-[0-9a-zA-Z]+/.test(arg) && !arg.startsWith('--')) {
      const letters = /^-([0-9a-zA-Z]+)/.exec(arg)[1];
      if (letters.includes('i')) inPlace = true;
      if (arg === '-i' && args[j + 1] === '') j++;
      if ((isPerl ? /[eE]$/ : /e$/).test(letters) && !arg.includes('.')) exprs.push(args[++j] ?? '');
    } else if (!arg.startsWith('-') || arg === '-') rest.push(arg);
  }
  if (!exprs.length && rest.length) exprs.push(rest.shift());
  return inPlace ? { expr: exprs.join('\n'), files: rest } : null;
}

const isPackageCode = (ctx, path) => {
  const resolved = repoPath(ctx, path);
  return resolved !== null && resolved.startsWith('packages/') && (CODE_FILE.test(resolved) || /\*[^.]*$/.test(resolved));
};

function renamePair(expr) {
  for (const match of expr.matchAll(SUBSTITUTION)) {
    const from = match[2].replace(WORD_EDGE, '');
    const to = match[3].replace(WORD_EDGE, '');
    if (IDENTIFIER.test(from) && IDENTIFIER.test(to) && from !== to) return [from, to];
  }
  return null;
}

// sed -i / perl -i on TS or JS under packages/ that rewrites import paths, or renames an identifier across files.
export function rewriteReason(cmd, ctx) {
  const edit = parseInPlace(cmd.words);
  if (!edit) return null;
  const inScope = edit.files.some((file) => isPackageCode(ctx, file)) || (cmd.fed && CODE_MENTION.test(ctx.text));
  if (!inScope) return null;
  if (IMPORT_EDIT.test(edit.expr)) return `${MOVE_HINT} A symbol rename: node scripts/codemods/renameSymbol.mjs <file> <old> <new>.`;
  const bulk = cmd.fed || edit.files.length > 1 || edit.files.some((file) => /[*?{]/.test(file));
  const pair = bulk ? renamePair(edit.expr) : null;
  if (!pair) return null;
  return `Use: node scripts/codemods/renameSymbol.mjs <file-that-exports-it> ${pair[0]} ${pair[1]} (add --dry-run first); it renames every import and use. Moving files: moveFiles.mjs moves.tsv.`;
}

// git mv of TS or JS files, or of a folder under packages/: moveFiles.mjs moves it and fixes the imports.
export function gitMoveReason(cmd, ctx) {
  const [name, ...args] = cmd.words;
  if (basename(name ?? '') !== 'git') return null;
  const [verb, ...rest] = skipOptions(args, GIT_VALUED);
  if (verb !== 'mv') return null;
  const operands = rest.filter((word) => !word.startsWith('-'));
  const sources = operands.slice(0, -1);
  const movesCode = sources.some((source) => {
    const resolved = repoPath(ctx, source);
    const last = (resolved ?? source).split('/').pop();
    return CODE_FILE.test(source) || (resolved?.startsWith('packages/') === true && !last.includes('.'));
  });
  return movesCode ? MOVE_HINT : null;
}
