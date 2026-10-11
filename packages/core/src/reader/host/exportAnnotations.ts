/**
 * Exports a paper's annotations as Markdown, for the reader's export buttons and for host commands outside the reader.
 */
import { formatAnnotationsMarkdown } from "../annotationsMarkdown.js";
import type { ExportAnnotationsPorts } from "./ports.js";

/**
 * Copies the Markdown to the clipboard with a confirmation, or hands it to the host to save as a file.
 * @returns resolves once the copy or the host's save has finished.
 */
export async function exportAnnotations(ports: ExportAnnotationsPorts, target: "clipboard" | "file"): Promise<void> {
  const markdown = formatAnnotationsMarkdown(ports.paper, await ports.store.getAnnotations(ports.paper.id));
  if (target === "clipboard") {
    await ports.writeClipboard(markdown);
    ports.notify("Annotations copied as Markdown", "ok");
    return;
  }
  await ports.saveAnnotations(markdown);
}
