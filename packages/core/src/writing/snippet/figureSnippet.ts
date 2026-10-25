// Builds a figure that shows an image file as a snippet whose tab stops are the caption and label.
import { snippetText } from "./snippetText.js";

/** @param imagePath The image path as the compiler resolves it, with "/" separators. */
export function imageSnippet(language: "latex" | "typst", imagePath: string): string {
  if (language === "typst") {
    const quoted = JSON.stringify(imagePath);
    return [
      "#figure(",
      `\timage(${snippetText(quoted)}, width: 80%),`,
      "\tcaption: [${1:Caption}],",
      ") <fig:${2:label}>",
      "$0",
    ].join("\n");
  }
  return [
    snippetText("\\begin{figure}[h]"),
    `\t${snippetText("\\centering")}`,
    `\t${snippetText(`\\includegraphics[width=0.8\\linewidth]{${imagePath}}`)}`,
    `\t${snippetText("\\caption{")}\${1:Caption}${snippetText("}")}`,
    `\t${snippetText("\\label{fig:")}\${2:label}${snippetText("}")}`,
    snippetText("\\end{figure}"),
    "$0",
  ].join("\n");
}
