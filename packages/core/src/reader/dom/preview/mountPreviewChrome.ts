// Composes a preview's chrome around the reader: the header above the pages, the footer below them, and the logs and page-count pieces beside them.
import { $ } from "../../../ui/dom/index.js";
import type { PreviewRoots, WebviewToHost } from "../../index.js";
import type { OutlineRow } from "../../logic/index.js";
import { mountPreviewHeader, type RecompileState } from "./header/index.js";
import type { LogsView } from "./logs/index.js";
import { mountPreviewFooter, PageChip, type PreviewBuildStatus } from "./footer/index.js";

export interface PreviewOutlineSource {
  load(): Promise<{ rows: OutlineRow[]; pages: Array<number | null> }>;
  currentPage(): number;
  onPageChange(fn: () => void): void;
  jump(row: OutlineRow): void;
}

interface PreviewChromeDeps {
  post: (msg: WebviewToHost) => void;
  logs: Pick<LogsView, "open" | "setRoots">;
  find: Parameters<typeof mountPreviewHeader>[0]["find"];
  sidebar: Parameters<typeof mountPreviewHeader>[0]["sidebar"];
  /** The PDF outline the footer's breadcrumb follows. */
  outline: PreviewOutlineSource;
  /** Counts the body pages of the open document. */
  countBodyPages: () => Promise<number>;
}

export interface PreviewChrome {
  applyRoots(roots: PreviewRoots): void;
  applyBuild(build: PreviewBuildStatus): void;
  /** Follows the host's effective theme. */
  setDark(dark: boolean): void;
  /** The open document was replaced, so its body pages are counted again. */
  documentChanged(): void;
}

function recompileState({ state, stale }: PreviewBuildStatus): RecompileState {
  if (state === "building") { return "building"; }
  return stale ? "stale" : "current";
}

/**
 * Inserts the preview header and footer into the shell and switches the document to preview layout.
 * @returns handles the reader's host messages call to refresh the chrome.
 */
export function mountPreviewChrome({ post, logs, find, sidebar, outline, countBodyPages }: PreviewChromeDeps): PreviewChrome {
  const header = mountPreviewHeader({ post, find, sidebar, pill: $("status-pill") });
  $("viewerContainer").before(header.element);
  document.documentElement.classList.add("rd-preview");
  const footer = mountPreviewFooter({ openLogs: (path) => logs.open(path), outline });
  $("viewerContainer").after(footer.element);
  footer.slots.limit.hidden = false;
  const chip = new PageChip({ actions: footer.slots.limit, post, countBodyPages });

  return {
    applyRoots(roots) {
      logs.setRoots(roots);
      footer.setRoots(roots);
      chip.setRoots(roots);
    },
    applyBuild(build) {
      header.setBuild(recompileState(build));
      footer.setBuild(build);
    },
    setDark: (dark) => header.setDark(dark),
    documentChanged() {
      footer.documentChanged();
      chip.documentChanged();
    },
  };
}
