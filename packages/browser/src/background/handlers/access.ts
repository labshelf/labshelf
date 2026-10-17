// Opens the page that stood in the way of a paper's PDF (paper.openForPdf, or a capture's "open" choice) and attaches
// the PDF once the user signs in or passes the check there.
import type { ILogger, PdfAccess } from "@labshelf/core";
import { attachPdfToPaper, openAccessTab, summarizeAttempts, type AccessTabDeps, type CaptureDraft } from "../../capture/index";
import { listAllRecords, type LibraryMutations } from "../../storage";
import { broadcastChanged } from "../broadcast";

/** What a watched tab needs to attach a PDF: the write and the notice to open library pages. */
export function accessTabDeps(log: ILogger, mutations: LibraryMutations): AccessTabDeps {
  return {
    log,
    async attach(paperId, bytes) {
      const { record, written } = await attachPdfToPaper(mutations, paperId, bytes);
      if (written) {
        broadcastChanged("attach", paperId, `PDF attached to "${record.title}"`);
      }
      return written;
    },
  };
}

/** Library page "Open to sign in" / "Open to pass the check" on a paper already saved. */
export async function handleOpenForPdf(deps: AccessTabDeps, msg: { id: string; access: PdfAccess }): Promise<{ opened: true }> {
  // The URL crosses runtime messaging, so only a web page is opened, never a script or extension URL.
  if (!/^https?:\/\//i.test(msg.access.url)) throw new Error("LabShelf opens only web pages for a PDF.");
  const record = (await listAllRecords()).find((r) => r.id === msg.id);
  if (!record) throw new Error("This paper is no longer in your library.");
  await openAccessTab(deps, { id: record.id, title: record.title }, msg.access);
  return { opened: true };
}

/** A capture saved with "open": opens the access page its PDF search ran into, for the paper it saved. */
export async function openAccessAfterCapture(deps: AccessTabDeps, draft: CaptureDraft, paper: { id: string; title: string }): Promise<void> {
  const { access } = summarizeAttempts(draft.pdfAttempts);
  if (access) await openAccessTab(deps, paper, access);
  else void deps.log.log("WARN", "capture", "open asked, but no sign-in or bot check stood in the way", { paperId: paper.id });
}
