// Keeps Overview dialogs alive while refreshing its Space cards.
import type { SpaceDate } from "../../model/index.js";
import type { OverviewContext, SpaceSnapshot } from "./overviewContext.js";
import { openDateDialog } from "./openDateDialog.js";
import { renderElement, renderEmptyNotice, renderMemberChip, setPlannedNotice, renderSectionCard, renderProgressMark, pickQuickEntry } from "../../../ui/dom/index.js";
import { openPaperPicker } from "../papers/index.js";
import { renderOverviewAction } from "./actions.js";
import { renderTimeline } from "./renderTimeline.js";
import { renderReadingStatusMark } from "../../../ui/icons/index.js";
import { formatDay } from "../../../time/index.js";

function projectList(ctx: OverviewContext): HTMLElement {
  const list = renderElement("div", { class: "ov-list" });
  for (const p of ctx.data.overview.projects) {
    const open = renderOverviewAction(p.title, () => ctx.end.post({ type: "openProject", projectId: p.projectId }), !p.available);
    open.classList.add("ov-name"); open.title = p.title;
    const main = renderElement("div", { class: "ov-main" }, open,
      renderElement("span", { class: "ov-sub", text: p.available ? [p.format, p.mainFile].filter(Boolean).join(" · ") : "Not on this device" }));
    const row = renderElement("div", { class: "ov-row" }, main);
    const side = renderElement("div", { class: "ov-side" });
    if (p.deadline) side.append(renderElement("time", { class: "ov-sub", datetime: p.deadline, text: `Due ${formatDay(p.deadline)}` }));
    if (p.checklist) side.append(renderElement("span", { class: "ov-check" }, renderProgressMark(p.checklist.done, p.checklist.total),
      renderElement("span", { class: "ov-sub", text: `${p.checklist.done} / ${p.checklist.total} Done` })));
    const unlink = renderOverviewAction("Unlink", () => ctx.end.post({ type: "unlinkProject", id: ctx.data.space.id, projectId: p.projectId }), ctx.readOnly);
    unlink.classList.add("ov-unlink");
    row.append(side, unlink);
    list.append(row);
  }
  if (!list.childElementCount) list.append(renderEmptyNotice({ inline: true, text: "No linked projects.", hint: "Link a project to see its deadline and checklist here." }));
  return list;
}
async function linkProject(ctx: OverviewContext): Promise<void> {
  const signal = ctx.signal;
  const linked = new Set(ctx.data.space.projects);
  const items = ctx.data.projects.filter(p => p.available && !linked.has(p.projectId));
  const projectId = await pickQuickEntry(items.map(p => ({ label: p.title, value: p.projectId })), { title: "Link a project", ...(signal ? { signal } : {}) });
  if (projectId && !signal?.aborted && !ctx.readOnly) ctx.end.post({ type: "linkProject", id: ctx.data.space.id, projectId });
}

let nextDescription = 0;
function focusPapers(ctx: OverviewContext): HTMLElement {
  const list = renderElement("div", { class: "ov-list" });
  for (const paper of ctx.data.overview.focus) {
    if (paper.missing) {
      list.append(renderElement("div", { class: "ov-row" }, renderElement("span", { class: "ov-main", text: `${paper.id} — Not in your Library` }),
        renderOverviewAction("Remove", () => ctx.end.post({ type: "removePaper", id: ctx.data.space.id, paperId: paper.id }), ctx.readOnly)));
      continue;
    }
    const status = paper.status === "done" ? "Done" : paper.status === "reading" ? "Reading" : "Unread";
    const open = renderOverviewAction(paper.title, () => ctx.end.post({ type: "openPaper", paperId: paper.id }));
    const descriptionId = `ls-space-focus-${++nextDescription}`;
    open.classList.add("ov-row", "ov-paper");
    open.setAttribute("aria-describedby", descriptionId);
    open.setAttribute("aria-label", paper.title); open.title = paper.title;
    open.replaceChildren(renderElement("span", { class: "ov-glyph", "aria-hidden": "true", html: renderReadingStatusMark(paper.status) }),
      renderElement("span", { class: "ov-main" }, renderElement("span", { class: "ov-name", text: paper.title }),
        renderElement("span", { class: "ov-sub", text: [...paper.authors, paper.year].filter(Boolean).join(" · ") })),
      renderElement("span", { id: descriptionId, class: `ov-status ${paper.status}`, text: status }));
    open.addEventListener("focus", () => ctx.end.post({ type: "selectPaper", paperId: paper.id }));
    list.append(open);
  }
  if (!list.childElementCount) list.append(renderEmptyNotice({ inline: true, text: "No papers in focus.", hint: "Mark the papers you are working on in Papers, and they stay here." }));
  return list;
}

function overviewCards(ctx: OverviewContext, edit: (date?: SpaceDate) => void): HTMLElement {
  const dates = renderElement("div");
  if (!ctx.data.overview.timeline.length) dates.append(renderEmptyNotice({ inline: true, text: "No dates yet.", hint: "Add a task, a reading goal or a deadline, and the timeline appears." }));
  dates.append(renderTimeline(ctx, date => edit(date)));
  const topic = renderOverviewAction("Start a topic", () => {}, false, "message");
  setPlannedNotice(topic, "Discussions need collaboration");
  const schedule = renderSectionCard({ title: "Dates and goals", icon: "calendar", actions: [renderOverviewAction("Add date", () => edit(), ctx.readOnly, "plus"),
      renderOverviewAction("Export .ics", () => ctx.end.post({ type: "exportIcs", id: ctx.data.space.id }), false, "download")], body: dates });
  const planned = renderElement("div", { class: "ov-col ov-planning" },
    renderSectionCard({ title: "Discussions", icon: "message", actions: [topic], body: renderEmptyNotice({ inline: true, text: "No open topics.", hint: "Discussions need collaboration." }) }),
    renderSectionCard({ title: "Since your last visit", icon: "history", body: renderEmptyNotice({ inline: true, text: "Nothing new since your last visit.", hint: "Activity appears when others work in this Space." }) }));
  const right = renderElement("div", { class: "ov-col ov-research" },
    renderSectionCard({ title: "Projects", icon: "file-text", actions: [renderOverviewAction("Link", () => void linkProject(ctx), ctx.readOnly, "link")], body: projectList(ctx) }),
    renderSectionCard({ title: "Papers in focus", icon: "book-open", actions: [renderOverviewAction("Add papers", () => openPaperPicker(ctx), ctx.readOnly, "plus")], body: focusPapers(ctx) }),
    renderSectionCard({ title: "Members", icon: "users", body: renderElement("div", {}, renderElement("div", { class: "mem-row" }, renderMemberChip("You"),
      renderElement("span", { class: "ov-main", text: "You" }), renderElement("span", { class: "ov-sub", text: "Personal Space" })),
      renderEmptyNotice({ inline: true, text: "Only you.", hint: "Sharing needs a signed-in account." })) }));
  for (const panel of planned.querySelectorAll(".ls-card")) panel.classList.add("ov-planned");
  return renderElement("div", { class: "ov-grid" }, schedule, right, planned);
}

export interface SpaceBody {
  update(data: SpaceSnapshot): void;
  dispose(): void;
}
export function mountOverview(root: HTMLElement, initial: OverviewContext): SpaceBody {
  let controller = new AbortController();
  const ctx = { ...initial, signal: controller.signal };
  let closeDate: (() => void) | undefined;
  const edit = (date?: SpaceDate): void => { closeDate?.(); closeDate = openDateDialog(ctx, date); };
  const render = (): void => root.replaceChildren(overviewCards(ctx, edit));
  render();
  return {
    update(data) {
      ctx.data = data; ctx.readOnly = !!data.readOnlyReason;
      if (ctx.readOnly) { closeDate?.(); controller.abort(); controller = new AbortController(); ctx.signal = controller.signal; }
      render();
    },
    dispose() { closeDate?.(); controller.abort(); root.replaceChildren(); },
  };
}
