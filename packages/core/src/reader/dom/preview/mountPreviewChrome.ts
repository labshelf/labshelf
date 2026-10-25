// Composes a preview's chrome around the reader: the header above the pages, the footer below them, and the logs and problem marks over them.
import { findElement } from "../../../ui/dom/index.js";
import type { PageArea, PreviewRoots, WebviewToHost } from "../../index.js";
import type { OutlineRow } from "../../index.js";
import type { ReaderContext } from "../session/index.js";
import { mountLogsButton, mountOnlyToggle, mountOptionsMenu, mountPreviewHeader, type RecompileState } from "./header/index.js";
import type { LogsView } from "./logsView.js";
import { mountProblemMarks } from "./problemMarks.js";
import {
  mountChecksButton, mountLimitMeter, mountPreviewFooter, mountProblems, type PreviewBuildStatus, type PreviewProblems,
} from "./footer/index.js";

export interface PreviewOutlineSource {
  load(): Promise<{ rows: OutlineRow[]; pages: Array<number | null> }>;
  currentPage(): number;
  onPageChange(fn: () => void): void;
  jump(row: OutlineRow): void;
}

interface PreviewChromeDeps {
  post: (msg: WebviewToHost) => void;
  logs: Pick<LogsView, "open" | "setRoots">;
  /** The PDF outline the footer's breadcrumb follows. */
  outline: PreviewOutlineSource;
  /** Counts the body pages of the open document. */
  countBodyPages: () => Promise<number>;
  /** The viewer the problem marks are drawn over. */
  pdfViewer: ReaderContext["pdfViewer"];
  /** Brings a problem's area into view. */
  scrollTo(area: PageArea): void;
  /** Draws the pages dark (true) or as light paper (false); the Dark PDF button calls it. */
  setPagesDark(dark: boolean): void;
}

export interface PreviewChrome {
  applyRoots(roots: PreviewRoots): void;
  applyBuild(build: PreviewBuildStatus): void;
  /** The open document was replaced, so its body pages are counted again. */
  documentChanged(): void;
  /** Steps through the shown PDF's problems; the Next/Previous problem keys call it. */
  problems: PreviewProblems;
}

function recompileState({ state, stale }: PreviewBuildStatus): RecompileState {
  if (state === "building") { return "building"; }
  return stale ? "stale" : "current";
}

/**
 * Inserts the preview header and footer into the shell, draws the problem marks over the pages and switches the document to preview layout.
 * @returns handles the reader's host messages call to refresh the chrome.
 */
export function mountPreviewChrome({ post, logs, outline, countBodyPages, pdfViewer, scrollTo, setPagesDark }: PreviewChromeDeps): PreviewChrome {
  const header = mountPreviewHeader({ post, pill: findElement("status-pill"), setPagesDark });
  findElement("viewerContainer").before(header.element);
  document.documentElement.classList.add("rd-preview");
  const footer = mountPreviewFooter({ openLogs: (path) => logs.open(path), outline });
  findElement("viewerContainer").after(footer.element);

  const marks = mountProblemMarks({ container: findElement("viewerContainer"), pdfViewer });
  const options = mountOptionsMenu(header.slots.options, { post });
  const only = mountOnlyToggle(header.slots.only, { post });
  const logsButton = mountLogsButton(header.slots.logs, { post, openLogs: (path) => logs.open(path) });
  const problems = mountProblems(footer.slots.cites, { marks, scrollTo, post });
  const limit = mountLimitMeter(footer.slots.limit, { post, countBodyPages });
  const checks = mountChecksButton(footer.slots.checks, { post });

  return {
    applyRoots(roots) {
      logs.setRoots(roots);
      footer.setRoots(roots);
      for (const piece of [options, only, logsButton, problems, limit, checks]) { piece.setRoots(roots); }
      marks.setProblems(roots.roots.find((r) => r.path === roots.shown)?.pdfProblems ?? []);
    },
    applyBuild(build) {
      header.setBuild(recompileState(build));
      footer.setBuild(build);
    },
    documentChanged() {
      footer.documentChanged();
      limit.documentChanged();
    },
    problems,
  };
}
