// Renders hover text for the Typst symbol under a cursor: a signature fence with docs, a label's line or a citation.
import { plainField } from "../../writing/bibLint/index.js";
import { builtinMarkdown } from "./builtinDocs.js";
import type { ProjectFiles } from "./project/index.js";
import type { TypstHover } from "./typstLanguageSpec.js";
import { typstSymbolAt, type TypstSymbol } from "./typstSymbolAt.js";

export async function typstHover(files: ProjectFiles, offset: number): Promise<TypstHover | null> {
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
