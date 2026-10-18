// Converts language-server diagnostics of a Typst document into editor lint diagnostics.
import type { Diagnostic } from "@codemirror/lint";
import type { Text } from "@codemirror/state";
import { toOffset, type LspDiagnostic } from "./lsp";

const SEVERITIES: Record<number, Diagnostic["severity"]> = { 1: "error", 2: "warning", 3: "info", 4: "hint" };

export function lspDiagnostics(doc: Text, diagnostics: readonly LspDiagnostic[]): Diagnostic[] {
  return diagnostics.map((diagnostic) => ({
    from: toOffset(doc, diagnostic.range.start),
    to: toOffset(doc, diagnostic.range.end),
    // The LSP default severity is an error.
    severity: SEVERITIES[diagnostic.severity ?? 1] ?? "error",
    message: diagnostic.message,
  }));
}
