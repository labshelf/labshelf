// Word completion from a Hunspell dictionary: a sorted index of the .dic stems searched by prefix,
// plus the inflections of the matching stems, expanded on demand from the .aff suffix rules.
// The dictionaries carry no word frequencies, so completions rank base words (stems with affix flags, and the head
// of a derived word family such as pt-BR "computador" from "computar") before the other inflections.
import type { DictionaryFiles } from "./port.js";

/** The .dic stems in code-unit order, each with the flag fields of its entries. */
export interface StemIndex { readonly stems: readonly string[]; readonly flags: readonly (readonly string[])[] }

interface SuffixRule { strip: string; add: string; condition: RegExp | null }
type FlagMode = "char" | "long" | "num" | "utf8";
interface AffixRules { mode: FlagMode; aliases: string[]; suffixes: Map<string, SuffixRule[]> }

const MIN_PREFIX = 2;
const MAX_EXPANDED_STEMS = 30;

const indexes = new WeakMap<Uint8Array, StemIndex>();
const affixes = new WeakMap<Uint8Array, AffixRules>();

/** UTF-8 text without its byte-order mark. */
export function decode(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8").decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Splits a .dic line's first field into word and flag field, honouring an escaped `\/`. */
function splitEntry(field: string): [word: string, flags: string] {
  for (let at = field.indexOf("/"); at >= 0; at = field.indexOf("/", at + 1)) {
    if (at > 0 && field[at - 1] !== "\\") { return [field.slice(0, at).replaceAll("\\/", "/"), field.slice(at + 1)]; }
  }
  return [field.replaceAll("\\/", "/"), ""];
}

function buildIndex(dic: Uint8Array): StemIndex {
  const byWord = new Map<string, string[]>();
  const lines = decode(dic).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (i === 0 && /^\s*\d+\s*$/.test(line)) { continue; }
    const field = line.split(/[\t ]/, 1)[0];
    if (!field) { continue; }
    const [word, flags] = splitEntry(field);
    if (!word) { continue; }
    const known = byWord.get(word);
    if (known) { if (flags) { known.push(flags); } } else { byWord.set(word, flags ? [flags] : []); }
  }
  const stems = [...byWord.keys()].sort();
  return { stems, flags: stems.map((stem) => byWord.get(stem) ?? []) };
}

/** The stem index of a dictionary, built once per `.dic` buffer. */
export function stemIndex(dic: Uint8Array): StemIndex {
  let index = indexes.get(dic);
  if (!index) { index = buildIndex(dic); indexes.set(dic, index); }
  return index;
}

function splitFlags(raw: string, mode: FlagMode): string[] {
  if (mode === "num") { return raw.split(",").filter(Boolean); }
  if (mode === "long") {
    const flags: string[] = [];
    for (let i = 0; i + 1 < raw.length; i += 2) { flags.push(raw.slice(i, i + 2)); }
    return flags;
  }
  return mode === "utf8" ? [...raw] : raw.split("");
}

function conditionRegExp(condition: string): RegExp | null {
  if (!condition || condition === ".") { return null; }
  try { return new RegExp(`(?:${condition})$`, "u"); } catch { return null; }
}

function flagMode(value: string | undefined): FlagMode {
  switch (value) {
    case "long": return "long";
    case "num": return "num";
    case "UTF-8": return "utf8";
    default: return "char";
  }
}

function parseAffix(aff: Uint8Array): AffixRules {
  const rules: AffixRules = { mode: "char", aliases: [], suffixes: new Map() };
  const pending = new Map<string, number>();
  let aliasHeader = false;
  for (const line of decode(aff).split(/\r?\n/)) {
    const tokens = line.trim().split(/\s+/);
    switch (tokens[0]) {
      case "FLAG": rules.mode = flagMode(tokens[1]); break;
      case "AF":
        if (!aliasHeader) { aliasHeader = true; } else { rules.aliases.push(tokens[1] ?? ""); }
        break;
      case "SFX": {
        const [, flag, strip, addField, condition] = tokens;
        if (flag === undefined || strip === undefined || addField === undefined) { break; }
        const left = pending.get(flag) ?? 0;
        if (left === 0) { pending.set(flag, Number(addField) || 0); break; }
        pending.set(flag, left - 1);
        const add = addField.split("/", 1)[0] ?? "";
        const rule: SuffixRule = { strip: strip === "0" ? "" : strip, add: add === "0" ? "" : add, condition: conditionRegExp(condition ?? ".") };
        const list = rules.suffixes.get(flag);
        if (list) { list.push(rule); } else { rules.suffixes.set(flag, [rule]); }
        break;
      }
      default: break;
    }
  }
  return rules;
}

function affixRules(aff: Uint8Array): AffixRules {
  let rules = affixes.get(aff);
  if (!rules) { rules = parseAffix(aff); affixes.set(aff, rules); }
  return rules;
}

function entryFlags(field: string, rules: AffixRules): string[] {
  const alias = rules.aliases.length > 0 && /^\d+$/.test(field) ? rules.aliases[Number(field) - 1] : undefined;
  return splitFlags(alias ?? field, rules.mode);
}

interface Inflection { word: string; head: boolean }

/**
 * The words a stem's suffix flags derive (one level, no prefixes, no continuation classes). A flag whose words all start
 * with its shortest one derives a word family (pt-BR "dor", "dora", "dores": "computador" with its feminine and plural),
 * so that shortest word is a base word of its own, its `head`; a verb's conjugations or a single plural have none.
 */
function inflections(stem: string, flagFields: readonly string[], rules: AffixRules): Inflection[] {
  const found: Inflection[] = [];
  for (const field of flagFields) {
    for (const flag of entryFlags(field, rules)) {
      const words: string[] = [];
      for (const rule of rules.suffixes.get(flag) ?? []) {
        if (!stem.endsWith(rule.strip) || (rule.condition && !rule.condition.test(stem))) { continue; }
        words.push(stem.slice(0, stem.length - rule.strip.length) + rule.add);
      }
      const shortest = words.reduce<string | undefined>((best, word) => (best === undefined || word.length < best.length ? word : best), undefined);
      const family = shortest !== undefined && words.length > 1 && words.every((word) => word.startsWith(shortest));
      for (const word of words) { found.push({ word, head: family && word === shortest }); }
    }
  }
  return found;
}

/** The first index of a sorted list whose word is not below `prefix`. */
export function lowerBound(stems: readonly string[], prefix: string): number {
  let low = 0;
  let high = stems.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((stems[mid] ?? "") < prefix) { low = mid + 1; } else { high = mid; }
  }
  return low;
}

/** The stems that start with `prefix`, in index order, with their flag fields. */
function stemsWithPrefix(index: StemIndex, prefix: string): [stem: string, flags: readonly string[]][] {
  const found: [string, readonly string[]][] = [];
  for (let i = lowerBound(index.stems, prefix); i < index.stems.length; i += 1) {
    const stem = index.stems[i] ?? "";
    if (!stem.startsWith(prefix)) { break; }
    found.push([stem, index.flags[i] ?? []]);
  }
  return found;
}

/** Ranks of a completion: base words (flagged stems, extra words, family heads), then flagless stems, then inflections. */
const BASE = 0;
const FLAGLESS = 1;
const INFLECTION = 2;

/**
 * Completions of `prefix`: the matching stems and extra words, plus the inflections of the first matching stems, kept
 * when they start with the prefix and `accept` them; deduped, base words first (see the ranks), then shorter, then
 * code-unit order.
 */
export function completeWord(files: DictionaryFiles, prefix: string, options: { limit: number; accept: (word: string) => boolean; extra?: readonly string[] }): string[] {
  if (prefix.length < MIN_PREFIX || options.limit <= 0) { return []; }
  const index = stemIndex(files.dic);
  const matches = stemsWithPrefix(index, prefix);
  const ranks = new Map<string, number>();
  const offer = (word: string, rank: number): void => {
    const known = ranks.get(word);
    if (known === undefined || rank < known) { ranks.set(word, rank); }
  };
  for (const [stem, flags] of matches) { offer(stem, flags.length > 0 ? BASE : FLAGLESS); }
  for (const word of options.extra ?? []) { if (word.startsWith(prefix)) { offer(word, BASE); } }
  if (matches.length > 0) {
    const rules = affixRules(files.aff);
    for (const [stem, flags] of matches.slice(0, MAX_EXPANDED_STEMS)) {
      for (const { word, head } of inflections(stem, flags, rules)) { if (word.startsWith(prefix)) { offer(word, head ? BASE : INFLECTION); } }
    }
  }
  return [...ranks.entries()]
    .filter(([word]) => options.accept(word))
    .sort(([a, rankA], [b, rankB]) => rankA - rankB || a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, options.limit)
    .map(([word]) => word);
}
