// Opens the paper that a `?link=` parameter of the library page names, or reports why it cannot.
import { formatError, type ILogger, type PaperRecord } from "@labshelf/core";
import { resolvePaperLink } from "./resolvePaperLink";

export interface OpenPaperLinkDeps {
  readonly listRecords: () => Promise<PaperRecord[]>;
  /** Replaces this tab with the reader, so following a link leaves no extra tab. */
  readonly goToReader: (paperId: string, page?: number) => void;
  readonly notifyError: (message: string) => void;
  readonly log: ILogger;
}

export async function openPaperLinkParam(search: string, deps: OpenPaperLinkDeps): Promise<void> {
  const text = new URLSearchParams(search).get("link");
  if (text === null) return;
  try {
    const target = resolvePaperLink(text, await deps.listRecords());
    if (target.ok) {
      deps.goToReader(target.paperId, target.page);
    } else {
      deps.notifyError(target.message);
      void deps.log.log("WARN", "library-link", "Link not opened", { link: text, reason: target.message });
    }
  } catch (err) {
    deps.notifyError(`Could not open the link: ${formatError(err)}`);
    void deps.log.error("library-link", err);
  }
}
