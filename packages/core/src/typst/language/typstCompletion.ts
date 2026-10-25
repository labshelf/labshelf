// Completes Typst at a cursor: code names after # or in code, members after a dot, call parameters, labels and citations.
import { builtinCompletion, findBuiltin } from "./builtinDocs.js";
import { TYPST_LIBRARY } from "./library/index.js";
import { pathCompletions } from "./pathCompletion.js";
import { importedSymbols, linkedLabels, projectBibEntries, type ProjectFiles } from "./project/index.js";
import { typstContextAt, type TypstBinding, type TypstCursorContext } from "./syntax/index.js";
import type { TypstCompletion, TypstCompletions } from "./typstLanguageSpec.js";

const KEYWORDS = [
  "let", "set", "show", "import", "include", "if", "else", "for", "in", "while",
  "break", "continue", "return", "context", "none", "auto", "true", "false",
];

export async function typstCompletions(files: ProjectFiles, offset: number, explicit: boolean): Promise<TypstCompletions | null> {
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
