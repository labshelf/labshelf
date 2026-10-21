// Renders the papers marked for focus in a Space.
import { el, emptyState } from "../../../ui/dom/index.js";
import { statusMark } from "../../../ui/icons/index.js";
import type { OverviewContext } from "./context.js";
import { overviewAction } from "./actions.js";
export function focusPapers(ctx: OverviewContext): HTMLElement {
  const list = el("div", { class: "ov-list" });
  for (const paper of ctx.data.overview.focus) {
    const row = el("div", { class: "ov-row" });
    if (paper.missing) row.append(el("span", { class: "ov-main", text: `${paper.id} — Not in your Library` }),
      overviewAction("Remove", () => ctx.end.post({ type: "removePaper", id: ctx.data.space.id, paperId: paper.id }), ctx.readOnly));
    else {
      const open = overviewAction(paper.title, () => ctx.end.post({ type: "openPaper", paperId: paper.id }));
      open.classList.add("ov-name"); open.title = paper.title;
      open.addEventListener("focus", () => ctx.end.post({ type: "selectPaper", paperId: paper.id }));
      const status = paper.status === "done" ? "Done" : paper.status === "reading" ? "Reading" : "Unread";
      row.append(el("span", { html: statusMark(paper.status), title: status }),
        el("div", { class: "ov-main" }, open, el("span", { class: "ov-sub", text: `${paper.authors.join(", ")} · ${status}` })));
    }
    list.append(row);
  }
  if (!list.childElementCount) list.append(emptyState({ inline: true, text: "No papers in focus.", hint: "Mark the papers you are working on in Papers, and they stay here." }));
  return list;
}
