// Renders linked project cards with their host actions.
import { formatDay } from "../../../library/index.js";
import { el, emptyState, progressMark, quickPick } from "../../../ui/dom/index.js";
import type { OverviewContext } from "./overviewContext.js";
import { overviewAction } from "./actions.js";
export function projectList(ctx: OverviewContext): HTMLElement {
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
export async function linkProject(ctx: OverviewContext): Promise<void> {
  const signal = ctx.signal;
  const linked = new Set(ctx.data.space.projects);
  const items = ctx.data.projects.filter(p => p.available && !linked.has(p.projectId));
  const projectId = await quickPick(items.map(p => ({ label: p.title, value: p.projectId })), { title: "Link a project", ...(signal ? { signal } : {}) });
  if (projectId && !signal?.aborted && !ctx.readOnly) ctx.end.post({ type: "linkProject", id: ctx.data.space.id, projectId });
}
