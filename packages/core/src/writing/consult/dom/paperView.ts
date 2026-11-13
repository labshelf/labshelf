// The body of a paper's consult window: its pages read-only, with its highlights and note pins and the browser's own text selection.
import type { PdfDeckSource } from "../../../decks/dom/pdfDeck.js";
import { base64ToBytes } from "../../../encoding/base64.js";
import { formatError } from "../../../errors/index.js";
import type { Annotation } from "../../../model/index.js";
import { parseItemFile, type ItemFile } from "../../../qmd/item/index.js";
import { renderElement } from "../../../ui/dom/index.js";
import { deriveNotePins, mountPaperPages } from "../../dom/sourceEditor/paperPages.js";
import { askConsult, type ConsultClient } from "./consultClient.js";

export interface PaperView { ready: Promise<void>; destroy(): void }

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function readPaper(client: ConsultClient, paperId: string): Promise<{ bytes: ArrayBuffer; annotations: Annotation[]; notes: ItemFile | undefined }> {
  const [pdf, marks] = await Promise.all([
    askConsult(client, { kind: "paperPdf", paperId }),
    askConsult(client, { kind: "paperMarks", paperId }),
  ]);
  if (pdf.kind !== "pdf") { throw new Error("the host sent no PDF"); }
  if (marks.kind !== "marks") { throw new Error("the host sent no marks"); }
  return { bytes: toArrayBuffer(base64ToBytes(pdf.base64)), annotations: marks.annotations, notes: marks.notesText === null ? undefined : parseItemFile(marks.notesText) };
}

/** Mounts the paper's pages in `body`; a failure shows its sentence in the body instead, and `ready` resolves either way. */
export function mountPaperView(body: HTMLElement, options: { client: ConsultClient; paperId: string; pdfSource(bytes: ArrayBuffer): PdfDeckSource }): PaperView {
  let destroyed = false;
  let pages: { destroy(): void } | undefined;
  const showError = (error: unknown): void => {
    if (destroyed) return;
    pages?.destroy();
    pages = undefined;
    body.replaceChildren(renderElement("p", { class: "ls-consult-error", role: "alert", text: `Could not open the paper: ${formatError(error)}` }));
  };
  const ready = (async (): Promise<void> => {
    const paper = await readPaper(options.client, options.paperId);
    if (destroyed) return;
    const view = mountPaperPages(body, {
      source: options.pdfSource(paper.bytes), annotations: paper.annotations, notes: deriveNotePins(paper.notes, paper.annotations),
      onSelection: () => undefined, onHighlightClick: () => undefined, onNoteClick: () => undefined, onPageInView: () => undefined,
    });
    pages = view;
    await view.ready;
  })().catch(showError);
  return {
    ready,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      pages?.destroy();
      pages = undefined;
    },
  };
}
