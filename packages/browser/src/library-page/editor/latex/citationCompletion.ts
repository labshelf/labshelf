// Completes library papers inside a \cite-family command.
import type { CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import { partialKeyStart, type PaperRecord } from "@labshelf/core";
import { libraryCitationOptions } from "../citations";

export function citationCompletion(papers: () => Promise<readonly PaperRecord[]>): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const line = context.state.doc.lineAt(context.pos);
    const start = partialKeyStart("latex", line.text.slice(0, context.pos - line.from));
    if (start === undefined) return null;
    return { from: line.from + start, options: await libraryCitationOptions(papers), validFor: /^[^,{}\s]*$/ };
  };
}
