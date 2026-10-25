// Creates the Typst language service: completion, hover and definition over the edited text and the project's files.
import type { ILogger } from "../../ports/index.js";
import {
  projectFiles,
  importedSymbols,
  linkedLabels,
  projectBibEntries,
  type ProjectFiles,
  relativeTypstPath,
  lineAt,
  resolveTypstPath,
} from "./project/index.js";
import type {
  TypstLanguageService,
  TypstSources,
  TypstCompletion,
  TypstCompletions,
  TypstDefinition,
  TypstHover,
} from "./typstLanguageSpec.js";
import { builtinCompletion, findBuiltin, builtinMarkdown } from "./builtinDocs.js";
import { TYPST_LIBRARY } from "./typstStdlib/index.js";
import { typstContextAt, type TypstBinding, type TypstCursorContext } from "./syntax/index.js";
import { typstSymbolAt, type TypstSymbol } from "./typstSymbolAt.js";
import { plainField } from "../../writing/bibliography/index.js";

async function typstHover(files: ProjectFiles, offset: number): Promise<TypstHover | null> {
  const at = await typstSymbolAt(files, offset);
  return at ? { from: at.from, to: at.to, text: hoverText(at.symbol) } : null;
}

function hoverText(symbol: TypstSymbol): string {
  switch (symbol.kind) {
    case "builtin": return builtinMarkdown(symbol.found, symbol.name);
    case "binding": {
      const { signature, doc } = symbol.found.item;
      return [fence(signature), ...(doc === undefined ? [] : [doc])].join("\n\n");
    }
    case "label": {
      const { item, file } = symbol.found;
      return `${fence(item.context)}\n\n\`<${item.name}>\` in ${file.path}, line ${item.line + 1}`;
    }
    case "citation": {
      const { fields, key } = symbol.found.item;
      const title = plainField(fields.get("title")) || key;
      const byline = [plainField(fields.get("author")), plainField(fields.get("year") ?? fields.get("date"))].filter(Boolean).join(", ");
      return byline ? `**${title}**\n\n${byline}` : `**${title}**`;
    }
  }
}

function fence(code: string): string {
  return `\`\`\`typst\n${code}\n\`\`\``;
}

async function typstDefinition(files: ProjectFiles, offset: number): Promise<TypstDefinition | null> {
  const { current } = files;
  const { imports, includes, bibliographies } = current.symbols;
  const reference = [...imports, ...includes, ...bibliographies].find((candidate) => candidate.from <= offset && offset <= candidate.to);
  if (reference) {
    const path = resolveTypstPath(current.path, reference.path);
    return path !== undefined && (await files.list()).includes(path) ? { path, from: 0, to: 0, line: 0 } : null;
  }
  const at = await typstSymbolAt(files, offset);
  if (!at) { return null; }
  const { symbol } = at;
  switch (symbol.kind) {
    case "builtin": return null;
    case "binding":
    case "label": {
      const { item, file } = symbol.found;
      return { path: file.path, from: item.from, to: item.to, line: item.line };
    }
    case "citation": {
      const { item, file } = symbol.found;
      const from = file.text.indexOf(item.key, item.start);
      return { path: file.path, from, to: from + item.key.length, line: lineAt(file.text, from) };
    }
  }
}

/** The file extensions each path-taking call accepts; an empty list accepts any file. */
const EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  image: ["png", "jpg", "jpeg", "gif", "svg", "webp", "pdf"],
  read: [],
  csv: ["csv"],
  json: ["json"],
  yaml: ["yaml", "yml"],
  toml: ["toml"],
  xml: ["xml"],
  cbor: ["cbor"],
  bibliography: ["bib", "yaml", "yml"],
  include: ["typ"],
  import: ["typ"],
};

/** Paths relative to the current file, or null when the string is not a path argument. */
async function pathCompletions(files: ProjectFiles, string: NonNullable<TypstCursorContext["string"]>, offset: number): Promise<TypstCompletions | null> {
  const extensions = string.call === undefined ? undefined : EXTENSIONS[string.call];
  if (!extensions) { return null; }
  const current = files.current.path;
  const fits = (path: string) => extensions.length === 0 || extensions.includes(path.slice(path.lastIndexOf(".") + 1).toLowerCase());
  const options = (await files.list())
    .filter((path) => path !== current && fits(path))
    .map((path) => {
      const relative = relativeTypstPath(current, path);
      return { label: relative, kind: "file" as const, insert: relative, snippet: false };
    });
  return { from: string.from, to: offset, options };
}

const KEYWORDS = [
  "let", "set", "show", "import", "include", "if", "else", "for", "in", "while",
  "break", "continue", "return", "context", "none", "auto", "true", "false",
];

async function typstCompletions(files: ProjectFiles, offset: number, explicit: boolean): Promise<TypstCompletions | null> {
  const context = typstContextAt(files.current.text, offset);
  if (context.inComment || context.inRaw) { return null; }
  if (context.string) { return pathCompletions(files, context.string, offset); }
  const span = { from: context.word.from, to: offset };
  const { mode, trigger } = context;
  if (mode === "markup" && (trigger === "@" || trigger === "<")) { return { ...span, options: await referenceOptions(files, trigger === "@") }; }
  if (trigger === ".") { return mode === "markup" ? null : { ...span, options: await memberOptions(files, context) }; }
  if (mode === "markup" && trigger !== "#") { return explicit ? { ...span, options: await codeOptions(files, offset, "#") } : null; }
  if (mode === "math" && trigger !== "#") {
    if (!explicit && context.word.text === "") { return null; }
    return { ...span, options: (findBuiltin("math")?.members ?? []).map((item) => builtinCompletion(item)) };
  }
  const params = parameterOptions(context);
  if (!explicit && trigger === "" && context.word.text === "" && params.length === 0) { return null; }
  return { ...span, options: [...params, ...await codeOptions(files, offset)] };
}

/** Keywords, the library's top level, the file's bindings before the cursor and what its imports bring in. */
async function codeOptions(files: ProjectFiles, offset: number, prefix = ""): Promise<TypstCompletion[]> {
  const imported = await importedSymbols(files, files.current);
  const local = files.current.symbols.bindings.filter((binding) => binding.from < offset);
  return dedupe([
    ...KEYWORDS.map((keyword): TypstCompletion => ({ label: keyword, kind: "keyword", insert: prefix + keyword, snippet: false })),
    ...[...local].reverse().map((binding) => bindingCompletion(binding, prefix)),
    ...imported.bindings.map(({ item }) => bindingCompletion(item, prefix)),
    ...imported.modules.map(({ name, file }): TypstCompletion => ({ label: name, kind: "module", detail: file.path, insert: prefix + name, snippet: false })),
    ...TYPST_LIBRARY.map((item) => builtinCompletion(item, prefix)),
  ]);
}

async function memberOptions(files: ProjectFiles, context: TypstCursorContext): Promise<TypstCompletion[]> {
  const receiver = context.receiver ?? "";
  const module = (await importedSymbols(files, files.current)).modules.find((candidate) => candidate.name === receiver);
  if (module) { return module.file.symbols.bindings.filter((binding) => binding.topLevel).map((binding) => bindingCompletion(binding)); }
  return (findBuiltin(receiver, context.mode === "math")?.members ?? []).map((item) => builtinCompletion(item));
}

function parameterOptions(context: TypstCursorContext): TypstCompletion[] {
  if (context.mode !== "code" || !context.call) { return []; }
  const { callee, given } = context.call;
  return (findBuiltin(callee)?.params ?? [])
    .filter((param) => !param.positional && !given.includes(param.name))
    .map((param) => ({ label: param.name, kind: "parameter", detail: param.type, doc: param.doc, insert: `${param.name}: `, snippet: false }));
}

async function referenceOptions(files: ProjectFiles, withCitations: boolean): Promise<TypstCompletion[]> {
  const labels = (await linkedLabels(files)).map(({ item, file }): TypstCompletion => (
    { label: item.name, kind: "label", detail: `${file.path}:${item.line + 1}`, doc: item.context, insert: item.name, snippet: false }
  ));
  if (!withCitations) { return dedupe(labels); }
  const keys = (await projectBibEntries(files)).map(({ item }): TypstCompletion => (
    { label: item.key, kind: "citation", detail: item.type, insert: item.key, snippet: false }
  ));
  return dedupe([...labels, ...keys]);
}

function bindingCompletion(binding: TypstBinding, prefix = ""): TypstCompletion {
  const isFunction = binding.params !== undefined;
  const completion: TypstCompletion = {
    label: binding.name,
    kind: isFunction ? "function" : "variable",
    detail: binding.signature,
    insert: isFunction ? `${prefix}${binding.name}(\${1})` : prefix + binding.name,
    snippet: isFunction,
  };
  if (binding.doc !== undefined) { completion.doc = binding.doc; }
  return completion;
}

/** The first option of each label wins, so nearer definitions shadow farther ones. */
function dedupe(options: TypstCompletion[]): TypstCompletion[] {
  const seen = new Set<string>();
  return options.filter((option) => !seen.has(option.label) && seen.add(option.label));
}

export function createTypstLanguageService(options: { sources: TypstSources; logger: ILogger }): TypstLanguageService {
  const { sources, logger } = options;
  return {
    complete: (path, text, offset, explicit) => typstCompletions(projectFiles(sources, logger, path, text, "complete"), offset, explicit),
    hover: (path, text, offset) => typstHover(projectFiles(sources, logger, path, text, "hover"), offset),
    definition: (path, text, offset) => typstDefinition(projectFiles(sources, logger, path, text, "definition"), offset),
  };
}
