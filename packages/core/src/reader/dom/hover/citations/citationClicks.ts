// Opens the cited library paper when a preview's citation link is clicked; every other link keeps its own jump.
import type { ReaderContext } from "../../session/index.js";
import { findLink } from "../linkTarget.js";
import type { PreviewCitations } from "./previewCitations.js";

/**
 * Takes over internal link clicks in the capture phase, because the answer is asynchronous and pdf.js' handler is not.
 * A link that cites no library paper is clicked again, so pdf.js follows it as it would have.
 */
export function interceptCitationClicks(viewer: HTMLElement, ctx: ReaderContext, citations: PreviewCitations): void {
  if (!ctx.boot.preview) { return; }
  let replaying = false;
  viewer.addEventListener("click", (e) => {
    const link = replaying ? null : findLink(e);
    if (!link) { return; }
    e.preventDefault();
    e.stopPropagation();
    const anchor = e.target as Element;
    // A failed lookup means no paper: the link keeps its normal jump.
    void citations.linkEntries(link).catch(() => []).then((entries) => {
      const paper = entries.find((entry) => entry.paper)?.paper;
      if (paper) { citations.open(paper.id); return; }
      replaying = true;
      try { anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); } finally { replaying = false; }
    });
  }, true);
}
