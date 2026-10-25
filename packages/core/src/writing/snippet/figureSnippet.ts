// Builds a figure that shows an image file as a snippet whose tab stops are the caption and label.
import { escapeSnippetText } from "./escapeSnippetText.js";

/** @param imagePath The image path as the compiler resolves it, with "/" separators. */
export function createImageSnippet(language: "latex" | "typst", imagePath: string): string {
  if (language === "typst") {
    const quoted = JSON.stringify(imagePath);
    return [
      "#figure(",
      `\timage(${escapeSnippetText(quoted)}, width: 80%),`,
      "\tcaption: [${1:Caption}],",
      ") <fig:${2:label}>",
      "$0",
    ].join("\n");
  }
  return [
    escapeSnippetText("\\begin{figure}[h]"),
    `\t${escapeSnippetText("\\centering")}`,
    `\t${escapeSnippetText(`\\includegraphics[width=0.8\\linewidth]{${imagePath}}`)}`,
    `\t${escapeSnippetText("\\caption{")}\${1:Caption}${escapeSnippetText("}")}`,
    `\t${escapeSnippetText("\\label{fig:")}\${2:label}${escapeSnippetText("}")}`,
    escapeSnippetText("\\end{figure}"),
    "$0",
  ].join("\n");
}
