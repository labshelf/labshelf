// Builds the pandoc command line that converts a project's main file to a Word, Markdown or HTML document.
import type { ProjectFormat } from "../projectFile.js";

export type DocumentExport = "docx" | "markdown" | "html";

export const DOCUMENT_EXPORT_EXTENSIONS: Record<DocumentExport, string> = { docx: "docx", markdown: "md", html: "html" };

// GitHub Markdown keeps tables and math that pandoc's default Markdown writes in its own extensions.
const PANDOC_WRITERS: Record<DocumentExport, string> = { docx: "docx", markdown: "gfm", html: "html" };

/** The arguments after `pandoc`; `main` is relative to the folder pandoc runs in, so relative images resolve. */
export function pandocArgs(format: ProjectFormat, main: string, target: DocumentExport, output: string): string[] {
  return [
    "--from", format, "--to", PANDOC_WRITERS[target],
    ...(target === "html" ? ["--standalone"] : []),
    "--output", output, main,
  ];
}
