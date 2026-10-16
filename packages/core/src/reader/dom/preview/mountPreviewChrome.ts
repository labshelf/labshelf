// Mounts a preview's toolbar actions (recompile, source links) and keeps its build notice and logs view in step with the host.
import { icon } from "../../../ui/index.js";
import type { BuildState, PagePoint, PreviewRoots, WebviewToHost } from "../../index.js";
import type { BuildBanner } from "../chrome/index.js";
import { iconButton } from "../elements/index.js";
import type { LogsView } from "./logsView.js";
import { PreviewNotice } from "./previewNotice.js";

interface PreviewChromeDeps {
  /** The toolbar's slot for host actions; unhidden on mount. */
  actions: HTMLElement;
  banner: BuildBanner;
  post: (msg: WebviewToHost) => void;
  logs: Pick<LogsView, "open" | "setRoots">;
  /** The point at the top-left of the visible part of the current page. */
  visiblePoint: () => PagePoint;
}

export interface PreviewChrome {
  applyRoots(roots: PreviewRoots): void;
  applyBuild(state: BuildState, errors: number): void;
}

const CODE_TO_PDF = "Show the cursor in the PDF";
const PDF_TO_CODE = "Show this place in the source";
const NO_SOURCE_LINKS = "Typst does not link source and PDF yet";

function retitle(button: HTMLButtonElement, title: string): void {
  button.title = title;
  button.setAttribute("aria-label", title);
}

/**
 * Adds the preview's actions to the toolbar slot.
 * @returns handles the reader's host messages call to refresh the actions and the notice.
 */
export function mountPreviewChrome({ actions, banner, post, logs, visiblePoint }: PreviewChromeDeps): PreviewChrome {
  const notice = new PreviewNotice(banner, (rootPath) => logs.open(rootPath));
  const recompile = iconButton(icon("refresh"), "Recompile", "rd-preview-recompile");
  const toPdf = iconButton(icon("arrow-right"), CODE_TO_PDF);
  const toCode = iconButton(icon("arrow-left"), PDF_TO_CODE);
  recompile.addEventListener("click", () => post({ command: "recompile" }));
  toPdf.addEventListener("click", () => post({ command: "revealCursor" }));
  toCode.addEventListener("click", () => post({ command: "showSource", point: visiblePoint() }));
  actions.replaceChildren(recompile, toPdf, toCode);
  actions.hidden = false;

  return {
    applyRoots(roots) {
      const linked = roots.roots.find((r) => r.path === roots.shown)?.sourceLinks ?? true;
      toPdf.disabled = toCode.disabled = !linked;
      retitle(toPdf, linked ? CODE_TO_PDF : NO_SOURCE_LINKS);
      retitle(toCode, linked ? PDF_TO_CODE : NO_SOURCE_LINKS);
      notice.setRoots(roots);
      logs.setRoots(roots);
    },
    applyBuild(state, errors) {
      const busy = state === "building";
      if (busy) { recompile.setAttribute("aria-busy", "true"); } else { recompile.removeAttribute("aria-busy"); }
      recompile.innerHTML = icon(busy ? "loader" : "refresh");
      notice.setBuild(state, errors);
    },
  };
}
