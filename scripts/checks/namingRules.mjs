// Applies the naming vocabulary to a source path or an exported name and reports the violations; no I/O besides loading the yaml.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORD = /[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z0-9])/g;
const CAMEL = /^[a-z][a-zA-Z0-9]*$/;
const PASCAL = /^[A-Z][a-zA-Z0-9]*$/;
const FOLDER_KINDS = new Set(["domain", "runtime", "subject", "noun", "feature", "role", "uiPart", "format", "compound"]);
const FREE_WORD_LIMIT = 1;
const SIDE_KINDS = { subjects: "subject", nouns: "noun", formats: "format", tools: "tool", compounds: "compound" };

export const splitWords = (name) => (name.match(WORD) ?? []).map((word) => word.toLowerCase());

const singulars = (word) =>
  [word.endsWith("s") && word.slice(0, -1), word.endsWith("es") && word.slice(0, -2), word.endsWith("ies") && `${word.slice(0, -3)}y`].filter(Boolean);

function insertEntries(vocab, add) {
  const mechanism = vocab.mechanism ?? {};
  const termSections = [
    ["domain", vocab.domains],
    ["runtime", vocab.runtime],
    ["subject", vocab.subjects],
    ["noun", mechanism.nouns],
    ["feature", vocab.features],
    ["role", mechanism.roles],
    ["verb", mechanism.verbs],
  ];
  for (const [word, hint] of Object.entries(vocab.banned ?? {})) add(word, { kind: "banned", hint });
  for (const [word, rule] of Object.entries(vocab.compoundOnly ?? {})) {
    add(word, { kind: "compoundOnly", options: [...(rule.use ?? []), ...(rule.instead ?? [])] });
  }
  for (const [, section] of termSections) {
    for (const [term, value] of Object.entries(section ?? {})) {
      for (const syn of value?.syn ?? []) add(syn, { kind: "synonym", canon: term });
    }
  }
  for (const [term, feature] of Object.entries(vocab.features ?? {})) {
    for (const word of [term, ...(feature.words ?? [])]) add(word, { kind: "feature", term, home: feature.home ?? [] });
  }
  for (const rule of Object.values(vocab.compoundOnly ?? {})) for (const compound of rule.use ?? []) add(compound, { kind: "compound" });
  const plain = [
    ["domain", Object.keys(vocab.domains ?? {})],
    ["runtime", Object.keys(vocab.runtime ?? {})],
    ["tool", vocab.tools],
    ["format", vocab.formats],
    ["subject", Object.keys(vocab.subjects ?? {})],
    ["noun", Object.keys(mechanism.nouns ?? {})],
    ["role", Object.keys(mechanism.roles ?? {})],
    ["uiPart", mechanism.uiParts],
    ["verb", Object.keys(mechanism.verbs ?? {})],
    ["qualifier", mechanism.qualifiers],
    ["connector", mechanism.connectors],
    ["typeSuffix", mechanism.typeSuffixes],
  ];
  for (const [kind, terms] of plain) for (const term of terms ?? []) add(term, { kind });
}

// A form such as "<from>To<to>" becomes a regexp over the lowercased, space-joined words of a name; a literal word may not appear inside a slot.
function compileForm(form) {
  const parts = [...form.matchAll(/<(\w+)>|([A-Za-z][a-z0-9]*)/g)].map(([, slot, literal]) => ({ slot, literal: literal?.toLowerCase() }));
  return {
    regex: new RegExp(`^${parts.map((part) => (part.slot ? "(.+?)" : part.literal)).join(" ")}$`),
    slots: parts.filter((part) => part.slot).map((part) => part.slot),
    literals: new Set(parts.filter((part) => part.literal).map((part) => part.literal)),
  };
}

function compilePatterns(patterns) {
  return Object.entries(patterns ?? {}).map(([rule, { form, sides }]) => {
    const unknown = sides.filter((side) => !SIDE_KINDS[side]);
    if (unknown.length > 0) throw new Error(`namePatterns.${rule}: unknown sides ${unknown.join(", ")}`);
    return { rule, sides, kinds: new Set(sides.map((side) => SIDE_KINDS[side])), forms: [form].flat().map(compileForm) };
  });
}

// The index maps "word1 word2" to the first entry inserted for it, so the insertion order is the precedence.
export function buildIndex(vocab) {
  const words = new Map();
  const add = (term, entry) => {
    const key = splitWords(term).join(" ");
    if (key && !words.has(key)) words.set(key, entry);
  };
  insertEntries(vocab, add);
  const verbs = vocab.mechanism?.verbs ?? {};
  return {
    words,
    maxWords: Math.max(1, ...[...words.keys()].map((key) => key.split(" ").length)),
    verbs: new Set(Object.keys(verbs)),
    verbSynonyms: new Map(Object.entries(verbs).flatMap(([verb, value]) => (value.syn ?? []).map((syn) => [syn, verb]))),
    typeSuffixes: new Set(vocab.mechanism?.typeSuffixes ?? []),
    namePatterns: compilePatterns(vocab.mechanism?.namePatterns),
    domains: new Set([...Object.keys(vocab.domains ?? {}), ...Object.keys(vocab.runtime ?? {})]),
  };
}

export function loadVocabulary(path) {
  const { parse } = createRequire(resolve(root, "packages/core/package.json"))("yaml");
  return buildIndex(parse(readFileSync(path, "utf8")));
}

function lookup(index, parts) {
  const init = parts.slice(0, -1);
  const last = parts.at(-1);
  for (const variant of [last, ...singulars(last)]) {
    const entry = index.words.get([...init, variant].join(" "));
    if (entry) return entry;
  }
  return undefined;
}

// Greedy longest match; an unmatched word becomes a token without entry (a free word).
function tokenize(index, words) {
  const tokens = [];
  for (let i = 0; i < words.length; ) {
    let length = Math.min(index.maxWords, words.length - i);
    while (length > 1 && !lookup(index, words.slice(i, i + length))) length -= 1;
    const parts = words.slice(i, i + length);
    tokens.push({ text: parts.join(" "), parts, entry: lookup(index, parts) });
    i += length;
  }
  return tokens;
}

// A type suffix (options, result, state) is a word only as the last word of a multi-word name.
function analyse(index, name, allowSuffix) {
  const words = splitWords(name);
  const tokens = tokenize(index, words);
  const last = tokens.at(-1);
  if (allowSuffix && words.length > 1 && last.parts.length === 1) {
    const suffix = [last.parts[0], ...singulars(last.parts[0])].some((word) => index.typeSuffixes.has(word));
    if (suffix) last.entry = { kind: "typeSuffix" };
  }
  return tokens;
}

function wordViolations(tokens, context) {
  const found = [];
  for (const { text, entry } of tokens) {
    if (entry?.kind === "banned") found.push({ rule: "banned", message: `${context}"${text}" is banned`, hint: entry.hint, words: [text] });
    if (entry?.kind === "synonym") found.push({ rule: "synonym", message: `${context}"${text}" is not a term`, hint: `use ${entry.canon}`, words: [text] });
    if (entry?.kind === "compoundOnly") {
      const hint = `use one of ${entry.options.join(", ")}`;
      found.push({ rule: "compound-only", message: `${context}"${text}" is only valid inside a compound`, hint, words: [text] });
    }
  }
  return found;
}

function freeWordViolations(tokens, context) {
  const free = tokens.filter((token) => !token.entry).map((token) => token.text);
  if (free.length <= FREE_WORD_LIMIT) return [];
  const message = `${context}${free.length} free words: ${free.join(", ")} (max ${FREE_WORD_LIMIT})`;
  return [{ rule: "free-words", message, hint: "name it with known terms or add the word to scripts/checks/vocabulary.yaml", words: free }];
}

export function globToRegExp(glob) {
  const parts = glob.split("/");
  const source = parts.map((part, i) => {
    const last = i === parts.length - 1;
    if (part === "**") return last ? ".*" : "(?:[^/]+/)*";
    return part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + (last ? "" : "/");
  });
  return new RegExp(`^${source.join("")}$`);
}

function featureViolations(tokens, srcPath) {
  const found = new Map();
  for (const { entry } of tokens) {
    if (entry?.kind !== "feature" || found.has(entry.term)) continue;
    if (entry.home.some((glob) => globToRegExp(glob).test(srcPath))) continue;
    const hint = `${entry.term} belongs under ${entry.home.join(" or ")}`;
    found.set(entry.term, { rule: "feature-home", message: `feature term "${entry.term}" used outside its home`, hint, words: [entry.term] });
  }
  return [...found.values()];
}

function folderViolations(index, segment, level) {
  if (!CAMEL.test(segment)) return [{ rule: "folder-case", message: `folder "${segment}" is not camelCase`, hint: "rename it in camelCase", words: [] }];
  const context = `folder "${segment}": `;
  const tokens = analyse(index, segment, false);
  const found = wordViolations(tokens, context);
  if (level === 0) {
    if (!index.domains.has(segment)) found.push({ rule: "folder-term", message: `${context}top-level folder is not a domain or runtime`, hint: "add it under domains in vocabulary.yaml or use an existing one", words: [segment] });
    return found;
  }
  const single = tokens.length === 1 ? tokens[0] : undefined;
  if (single?.entry?.kind === "tool") found.push({ rule: "folder-term", message: `${context}a tool name cannot be a folder`, hint: "name the folder after the domain it serves", words: [segment] });
  else if (!single || (!FOLDER_KINDS.has(single.entry?.kind) && !found.length)) {
    found.push({ rule: "folder-term", message: `${context}not a single known term`, hint: "use one domain, subject, role, format or compound word", words: tokens.filter((token) => !FOLDER_KINDS.has(token.entry?.kind)).map((token) => token.text) });
  }
  return found;
}

// relPath is repo-relative (packages/<pkg>/src/...). classFile: the file's main export is a class named like the file (PascalCase allowed).
export function checkPath(index, relPath, { classFile = false } = {}) {
  const match = /^packages\/[^/]+\/src\/(.+)$/.exec(relPath);
  if (!match) return [];
  const segments = match[1].split("/");
  const file = segments.pop();
  const base = file.replace(/\.[^.]+$/, "");
  const found = segments.flatMap((segment, level) => folderViolations(index, segment, level));
  if (!(classFile ? PASCAL : CAMEL).test(base)) {
    found.push({ rule: "file-case", message: `file "${base}" is not ${classFile ? "PascalCase" : "camelCase"}`, hint: classFile ? "" : "PascalCase is for a file whose main export is a class", words: [] });
  }
  const context = `file "${base}": `;
  const tokens = analyse(index, base, true);
  const allTokens = [...segments.flatMap((segment) => tokenize(index, splitWords(segment))), ...tokens];
  return [...found, ...wordViolations(tokens, context), ...freeWordViolations(tokens, context), ...featureViolations(allTokens, match[1])];
}

function matchPattern(pattern, words) {
  for (const { regex, slots, literals } of pattern.forms) {
    const match = regex.exec(words.join(" "));
    const sides = match ? slots.map((slot, i) => [slot, match[i + 1].split(" ")]) : [];
    if (match && !sides.some(([, sideWords]) => sideWords.some((word) => literals.has(word)))) return sides;
  }
  return undefined;
}

// A name of a declared form (bytesToHex) is valid when every word of each side is a term of an allowed kind; undefined when no form matches.
function patternViolations(index, name, context) {
  const words = splitWords(name);
  for (const pattern of index.namePatterns) {
    const sides = matchPattern(pattern, words);
    if (!sides) continue;
    return sides.flatMap(([side, sideWords]) => {
      const bad = tokenize(index, sideWords).filter((token) => !pattern.kinds.has(token.entry?.kind));
      if (bad.length === 0) return [];
      const text = bad.map((token) => token.text);
      return [{ rule: pattern.rule, message: `${context}${side} side ${text.map((word) => `"${word}"`).join(", ")} is not a vocabulary term`, hint: `each side is one or more of: ${pattern.sides.join(", ")}`, words: text }];
    });
  }
  return undefined;
}

function verbViolations(index, name, context) {
  const first = splitWords(name)[0];
  if (/^[A-Z]/.test(name) || index.verbs.has(first)) return [];
  const canon = index.verbSynonyms.get(first);
  if (canon) return [{ rule: "synonym", message: `${context}"${first}" is not a term`, hint: `use ${canon}`, words: [first] }];
  const hint = "start with a verb from vocabulary.yaml, such as create, read or find";
  return patternViolations(index, name, context) ?? [{ rule: "export-verb", message: `${context}function name does not start with a verb`, hint, words: [first] }];
}

// kind: function | class | interface | type | enum.
export function checkExportName(index, rawName, kind) {
  const name = rawName.replace(/^_+/, "");
  const isFunction = kind === "function";
  const subject = kind === "interface" ? name.replace(/^I(?=[A-Z])/, "") : name;
  const context = `export ${rawName}: `;
  const tokens = analyse(index, subject, !isFunction);
  const found = [...wordViolations(tokens, context)];
  if (isFunction) found.push(...verbViolations(index, name, context));
  else found.push(...freeWordViolations(tokens, context));
  const seen = new Set();
  return found.filter((violation) => !seen.has(violation.message) && seen.add(violation.message));
}
