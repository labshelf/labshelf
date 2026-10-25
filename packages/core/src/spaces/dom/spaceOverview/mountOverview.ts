// Keeps Overview dialogs alive while refreshing its Space cards.
import type { SpaceDate } from "../../model/index.js";
import type { OverviewContext, SpaceSnapshot } from "./overviewContext.js";
import { dateDialog } from "./dateDialog.js";
import { el, emptyState, memberChip, positioned, sectionCard, progressMark, quickPick } from "../../../ui/dom/index.js";
import { paperPicker } from "../papers/index.js";
import { overviewAction } from "./actions.js";
import { timeline } from "./timeline.js";
import { statusMark } from "../../../ui/icons/index.js";
import { formatDay } from "../../../library/index.js";

function projectList(ctx: OverviewContext): HTMLElement {
  const list = el("div", { class: "ov-list" });
  for (const p of ctx.data.overview.projects) {
    const open = overviewAction(p.title, () => ctx.end.post({ type: "openProject", projectId: p.projectId }), !p.available);
    open.classList.add("ov-name"); open.title = p.title;
    const main = el("div", { class: "ov-main" }, open,
      el("span", { class: "ov-sub", text: p.available ? [p.format, p.mainFile].filter(Boolean).join(" · ") : "Not on this device" }));
    const row = el("div", { class: "ov-row" }, main);
    const side = el("div", { class: "ov-side" });
    if (p.deadline) side.append(el("time", { class: "ov-sub", datetime: p.deadline, text: `Due ${formatDay(p.deadline)}` }));
    if (p.checklist) side.append(el("span", { class: "ov-check" }, progressMark(p.checklist.done, p.checklist.total),
      el("span", { class: "ov-sub", text: `${p.checklist.done} / ${p.checklist.total} Done` })));
    const unlink = overviewAction("Unlink", () => ctx.end.post({ type: "unlinkProject", id: ctx.data.space.id, projectId: p.projectId }), ctx.readOnly);
    unlink.classList.add("ov-unlink");
    row.append(side, unlink);
    list.append(row);
  }
  if (!list.childElementCount) list.append(emptyState({ inline: true, text: "No linked projects.", hint: "Link a project to see its deadline and checklist here." }));
  return list;
}
async function linkProject(ctx: OverviewContext): Promise<void> {
  const signal = ctx.signal;
  const linked = new Set(ctx.data.space.projects);
  const items = ctx.data.projects.filter(p => p.available && !linked.has(p.projectId));
  const projectId = await quickPick(items.map(p => ({ label: p.title, value: p.projectId })), { title: "Link a project", ...(signal ? { signal } : {}) });
  if (projectId && !signal?.aborted && !ctx.readOnly) ctx.end.post({ type: "linkProject", id: ctx.data.space.id, projectId });
}

let nextDescription = 0;
function focusPapers(ctx: OverviewContext): HTMLElement {
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

function overviewCards(ctx: OverviewContext, edit: (date?: SpaceDate) => void): HTMLElement {
  const dates = el("div");
  if (!ctx.data.overview.timeline.length) dates.append(emptyState({ inline: true, text: "No dates yet.", hint: "Add a task, a reading goal or a deadline, and the timeline appears." }));
  dates.append(timeline(ctx, date => edit(date)));
  const topic = overviewAction("Start a topic", () => {}, false, "message");
  positioned(topic, "Discussions need collaboration");
  const schedule = sectionCard({ title: "Dates and goals", icon: "calendar", actions: [overviewAction("Add date", () => edit(), ctx.readOnly, "plus"),
      overviewAction("Export .ics", () => ctx.end.post({ type: "exportIcs", id: ctx.data.space.id }), false, "download")], body: dates });
  const planned = el("div", { class: "ov-col ov-planning" },
    sectionCard({ title: "Discussions", icon: "message", actions: [topic], body: emptyState({ inline: true, text: "No open topics.", hint: "Discussions need collaboration." }) }),
    sectionCard({ title: "Since your last visit", icon: "history", body: emptyState({ inline: true, text: "Nothing new since your last visit.", hint: "Activity appears when others work in this Space." }) }));
  const right = el("div", { class: "ov-col ov-research" },
    sectionCard({ title: "Projects", icon: "file-text", actions: [overviewAction("Link", () => void linkProject(ctx), ctx.readOnly, "link")], body: projectList(ctx) }),
    sectionCard({ title: "Papers in focus", icon: "book-open", actions: [overviewAction("Add papers", () => paperPicker(ctx), ctx.readOnly, "plus")], body: focusPapers(ctx) }),
    sectionCard({ title: "Members", icon: "users", body: el("div", {}, el("div", { class: "mem-row" }, memberChip("You"),
      el("span", { class: "ov-main", text: "You" }), el("span", { class: "ov-sub", text: "Personal Space" })),
      emptyState({ inline: true, text: "Only you.", hint: "Sharing needs a signed-in account." })) }));
  for (const panel of planned.querySelectorAll(".ls-card")) panel.classList.add("ov-planned");
  return el("div", { class: "ov-grid" }, schedule, right, planned);
}

export interface SpaceBody {
  update(data: SpaceSnapshot): void;
  dispose(): void;
}
export function mountOverview(root: HTMLElement, initial: OverviewContext): SpaceBody {
  let controller = new AbortController();
  const ctx = { ...initial, signal: controller.signal };
  let closeDate: (() => void) | undefined;
  const edit = (date?: SpaceDate): void => { closeDate?.(); closeDate = dateDialog(ctx, date); };
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
