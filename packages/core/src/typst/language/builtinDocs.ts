// Looks up standard-library items by dotted name and renders their signature, hover text and completion entry.
import { TYPST_LIBRARY, type TypstBuiltin, type TypstParam } from "./typstStdlib/index.js";
import type { TypstCompletion } from "./typstLanguageSpec.js";

/** The item a dotted name like `calc.max` or `datetime.today` names; in math, `attach` also finds `math.attach`. */
export function findBuiltin(dotted: string, inMath = false): TypstBuiltin | undefined {
  const found = walk(TYPST_LIBRARY, dotted.split("."));
  return found ?? (inMath ? walk(TYPST_LIBRARY, ["math", ...dotted.split(".")]) : undefined);
}

/** A ```typst fence with the item's signature, its doc, then its parameters as a list. */
export function builtinMarkdown(item: TypstBuiltin, name: string): string {
  const params = (item.params ?? []).map((param) => `- \`${param.name}\` (\`${param.type}\`): ${param.doc}`);
  return [`\`\`\`typst\n${signature(item, name)}\n\`\`\``, item.doc, ...(params.length ? [params.join("\n")] : [])].join("\n\n");
}

export function builtinCompletion(item: TypstBuiltin, prefix = ""): TypstCompletion {
  const completion: TypstCompletion = { label: item.name, kind: item.kind, doc: item.doc, insert: prefix + item.name, snippet: false };
  if (item.kind === "function") {
    completion.insert = `${prefix}${item.name}(\${1})`;
    completion.snippet = true;
    if (item.returns !== undefined) { completion.detail = `-> ${item.returns}`; }
  }
  return completion;
}

function signature(item: TypstBuiltin, name: string): string {
  const params = (item.params ?? []).map(paramSignature).join(", ");
  switch (item.kind) {
    case "function": return `${name}(${params})${item.returns === undefined ? "" : ` -> ${item.returns}`}`;
    case "type": return item.params ? `type ${name}\n${name}(${params}) -> ${name}` : `type ${name}`;
    case "module": return `module ${name}`;
    case "value": return name;
  }
}

function paramSignature(param: TypstParam): string {
  const head = `${param.variadic ? ".." : ""}${param.name}: ${param.type}`;
  return param.default === undefined ? head : `${head} = ${param.default}`;
}

function walk(items: readonly TypstBuiltin[] | undefined, path: string[]): TypstBuiltin | undefined {
  const [head, ...rest] = path;
  const item = items?.find((candidate) => candidate.name === head);
  return item && rest.length ? walk(item.members, rest) : item;
}
