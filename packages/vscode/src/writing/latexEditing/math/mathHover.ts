// Previews the math under the pointer in a LaTeX file, rendered with the project's own macros.
import { COLOR_TOKENS, macrosToMathJax, scanLatexSource } from "@labshelf/core";
import type { DesignToken, MacroFact } from "@labshelf/core";
import { mathAt, mathImageUri, renderMathSvg } from "@labshelf/core/math";
import * as vscode from "vscode";

import type { LatexProjectSources } from "../project/index.js";

export function mathHoverProvider(sources: LatexProjectSources): vscode.HoverProvider {
  return {
    async provideHover(document, position) {
      const text = document.getText();
      const span = mathAt(text, document.offsetAt(position));
      if (!span) return undefined;
      const range = new vscode.Range(document.positionAt(span.start), document.positionAt(span.end));
      const macros = macrosToMathJax(await macrosFor(document, sources, text));
      return new vscode.Hover(previewMarkdown(span.tex, span.display, macros), range);
    },
  };
}

// A file outside a project still gets the macros it defines itself.
async function macrosFor(document: vscode.TextDocument, sources: LatexProjectSources, text: string): Promise<MacroFact[]> {
  const project = await sources.projectSourcesFor(document);
  return project ? project.files.flatMap((file) => file.facts.macros) : scanLatexSource(text).macros;
}

function previewMarkdown(tex: string, display: boolean, macros: ReturnType<typeof macrosToMathJax>): vscode.MarkdownString {
  try {
    const colors = { text: themed(COLOR_TOKENS.fg), error: themed(COLOR_TOKENS.error) };
    return new vscode.MarkdownString(`![math](${mathImageUri(renderMathSvg(tex, display, macros), colors)})`);
  } catch (error) {
    // The message is TeX's own parse error, which is what the writer needs to fix the math.
    const message = error instanceof Error ? error.message : String(error);
    const markdown = new vscode.MarkdownString();
    markdown.appendText(`Math preview: ${message}`);
    return markdown;
  }
}

function themed(token: DesignToken): string {
  const kind = vscode.window.activeColorTheme.kind;
  const light = kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight;
  return light && token.light !== undefined ? token.light : token.value;
}
