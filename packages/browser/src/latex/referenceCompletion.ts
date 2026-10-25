// Completes label names inside \ref, \eqref and \cref with the labels of the project's scanned files.
import type { CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import type { ProjectLabel } from "./projectLabels";

const OPEN_REFERENCE = /\\(?:ref|eqref|cref|Cref|autoref|pageref)\*?\{([^{}]*)$/;

/** Labels rank ahead of catalog commands, which carry a negative boost. */
export function referenceCompletion(labels: () => readonly ProjectLabel[]): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const open = OPEN_REFERENCE.exec(line.text.slice(0, context.pos - line.from));
    if (!open) return null;
    // A \cref{a,b} completes the name after the last comma.
    const typed = open[1]!.slice(open[1]!.lastIndexOf(",") + 1).trimStart();
    return {
      from: context.pos - typed.length,
      options: labels().map((label) => ({ label: label.name, detail: label.file, type: "variable" })),
      validFor: /^[^,{}\s]*$/,
    };
  };
}
