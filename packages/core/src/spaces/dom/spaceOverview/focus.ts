// Opens the papers marked for focus from their complete overview rows.
import { el, emptyState } from "../../../ui/dom/index.js";
import { statusMark } from "../../../ui/icons/index.js";
import type { OverviewContext } from "./overviewContext.js";
import { overviewAction } from "./actions.js";
let nextDescription = 0;
export function focusPapers(ctx: OverviewContext): HTMLElement {
  const list = el("div", { class: "ov-list" });
  for (const paper of ctx.data.overview.focus) {
    if (paper.missing) {
      list.append(el("div", { class: "ov-row" }, el("span", { class: "ov-main", text: `${paper.id} — Not in your Library` }),
        overviewAction("Remove", () => ctx.end.post({ type: "removePaper", id: ctx.data.space.id, paperId: paper.id }), ctx.readOnly)));
      continue;
    }
    const status = paper.status === "done" ? "Done" : paper.status === "reading" ? "Reading" : "Unread";
    const open = overviewAction(paper.title, () => ctx.end.post({ type: "openPaper", paperId: paper.id }));
    const descriptionId = `ls-space-focus-${++nextDescription}`;
    open.classList.add("ov-row", "ov-paper");
    open.setAttribute("aria-describedby", descriptionId);
    open.setAttribute("aria-label", paper.title); open.title = paper.title;
    open.replaceChildren(el("span", { class: "ov-glyph", "aria-hidden": "true", html: statusMark(paper.status) }),
      el("span", { class: "ov-main" }, el("span", { class: "ov-name", text: paper.title }),
        el("span", { class: "ov-sub", text: [...paper.authors, paper.year].filter(Boolean).join(" · ") })),
      el("span", { id: descriptionId, class: `ov-status ${paper.status}`, text: status }));
    open.addEventListener("focus", () => ctx.end.post({ type: "selectPaper", paperId: paper.id }));
    list.append(open);
  }
  if (!list.childElementCount) list.append(emptyState({ inline: true, text: "No papers in focus.", hint: "Mark the papers you are working on in Papers, and they stay here." }));
  return list;
}
