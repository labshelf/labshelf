/// <reference lib="dom" />
// The PDFs the LabShelf Editor webview shows, and Cite from Library's ports, as requests to the extension host (bridges.ts):
// the pdf.js assets every page shares, PDF bytes sent as base64 (a paper's, a deck's built one), and the citation scope store.
import type { SourceEditorDeps } from "@labshelf/core/sourceEditor";
import { base64ToBytes, type CitationScopeRecord } from "@labshelf/core";
import type { HostPorts } from "./hostPorts.js";

type PdfSource = NonNullable<ReturnType<NonNullable<SourceEditorDeps["pdfOf"]>>>;
type PdfMethod = "deckPdf" | "deckStylePreview" | "paperPdf";

/** The PDF a request answers as base64; undefined when the host answers none. */
export async function requestPdfBytes(ports: Pick<HostPorts, "request">, method: PdfMethod, params: Record<string, unknown>): Promise<ArrayBuffer | undefined> {
  const data = await ports.request(method, params);
  return typeof data === "string" ? base64ToBytes(data).slice().buffer : undefined;
}

/** The pdf.js assets of the page; a host without pdf.js rejects, and nothing that needs them can open. */
export async function requestPdfAssets(ports: Pick<HostPorts, "request">): Promise<PdfSource["assets"]> {
  return await ports.request("pdfAssets", {}) as PdfSource["assets"];
}

export type CitationPorts = Required<Pick<SourceEditorDeps, "pdfOf" | "scopesOf" | "libraryCitation">>;

/**
 * Cite from Library and the cite hover over the host: a paper's PDF once pdf.js is known (none before), the scope records of
 * a file, read once and again after each saved scope, and the save. The host brings the cited paper into the bibliography
 * when it saves the scope, so refreshBibliography asks for nothing more.
 */
export function createCitationPorts(ports: Pick<HostPorts, "request">): CitationPorts {
  let assets: PdfSource["assets"] | undefined;
  void requestPdfAssets(ports).then((found) => { assets = found; }, () => undefined);
  const scopes = new Map<string, Promise<readonly CitationScopeRecord[]>>();
  return {
    pdfOf: (paper) => assets && {
      assets,
      readBytes: async () => {
        const bytes = await requestPdfBytes(ports, "paperPdf", { paperId: paper.id });
        if (!bytes) { throw new Error(`No PDF of ${paper.title}`); }
        return bytes;
      },
    },
    scopesOf: (file) => {
      let records = scopes.get(file);
      if (!records) {
        records = ports.request("citationScopes", { file }).then((value) => (Array.isArray(value) ? value as CitationScopeRecord[] : []), () => []);
        scopes.set(file, records);
      }
      return records;
    },
    libraryCitation: {
      saveScope: async (record) => {
        try {
          await ports.request("saveCitationScope", { record });
        } finally {
          scopes.delete(record.file);
        }
      },
      refreshBibliography: async () => undefined,
    },
  };
}
