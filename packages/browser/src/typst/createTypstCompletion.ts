// Completes Typst from the core language service, with the library's papers first after an `@`.
import { snippet, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import type { PaperRecord } from "@labshelf/core";
import type { TypstCompletion, TypstCompletionKind, TypstLanguageService } from "@labshelf/core/typst/language";
import { listLibraryCitations } from "../latex";
import { deriveSnippetTemplate } from "../latex";

const TYPES: Record<TypstCompletionKind, string> = {
  function: "function", variable: "variable", keyword: "keyword", label: "constant", citation: "constant",
  file: "text", parameter: "property", module: "namespace", type: "type", value: "constant",
};

function toCompletion(item: TypstCompletion): Completion {
  return {
    label: item.label,
    type: TYPES[item.kind],
    ...(item.detail !== undefined && { detail: item.detail }),
    ...(item.doc !== undefined && { info: item.doc }),
    apply: item.snippet ? snippet(deriveSnippetTemplate(item.insert)) : item.insert,
  };
}

async function libraryItems(papers: () => Promise<readonly PaperRecord[]>, afterAt: boolean): Promise<{ options: Completion[]; keys: Set<string> }> {
  if (!afterAt) return { options: [], keys: new Set() };
  const all = await papers();
  return { options: await listLibraryCitations(async () => all), keys: new Set(all.map((paper) => paper.citeKey)) };
}

export function createTypstCompletion(service: TypstLanguageService, path: string, papers: () => Promise<readonly PaperRecord[]>): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const word = context.matchBefore(/[\w-]*/)!;
    const before = context.state.sliceDoc(Math.max(0, word.from - 1), word.from);
    if (!context.explicit && word.from === word.to && !/[#@.(]/.test(before)) return null;
    const result = await service.complete(path, context.state.doc.toString(), context.pos, context.explicit);
    const library = await libraryItems(papers, before === "@");
    const items = (result?.options ?? []).filter((item) => !library.keys.has(item.label));
    if (!result && library.options.length === 0) return null;
    return {
      from: result?.from ?? word.from,
      ...(result && { to: result.to }),
      options: [...library.options, ...items.map(toCompletion)],
    };
  };
}
