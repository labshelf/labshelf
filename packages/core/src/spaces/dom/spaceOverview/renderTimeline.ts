// Renders date rows with task completion, goal progress and the Today marker.
import { formatDay } from "../../../time/index.js";
import { renderElement, renderIcon, renderProgressMark } from "../../../ui/dom/index.js";
import type { TimelineEntry } from "../../viewModel/index.js";
import type { SpaceDate } from "../../model/index.js";
import type { OverviewContext } from "./index.js";
import { renderOverviewAction } from "./index.js";
export function renderTimeline(ctx: OverviewContext, edit: (date: SpaceDate) => void): HTMLElement {
  const list = renderElement("ol", { class: "tl-list" });
  let today = false;
  for (const entry of ctx.data.overview.timeline) {
    if (!today && entry.when !== "past") { list.append(todayMarker()); today = true; }
    list.append(timelineRow(entry, ctx, edit));
  }
  if (!today) list.append(todayMarker());
  return list;
}
const todayMarker = (): HTMLElement => renderElement("li", { class: "tl-today", text: "Today" });
function timelineRow(entry: TimelineEntry, ctx: OverviewContext, edit: (date: SpaceDate) => void): HTMLElement {
  const row = renderElement("li", { class: `tl-row ${entry.when}` });
  const content = renderElement("div", { class: "tl-item" });
  row.append(renderElement("div", { class: "tl-day" }, renderElement("time", { datetime: entry.date, title: entry.date, text: formatDay(entry.date) }),
    renderElement("span", { class: entry.overdue ? "tl-when late" : "tl-when", text: entry.overdue ? "Overdue" : entry.when === "today" ? "Today" : `${Math.abs(entry.daysAway)} days ${entry.when === "past" ? "ago" : "away"}` })), content);
  if (entry.kind === "task") {
    const box = renderElement("input", { type: "checkbox", "aria-label": entry.title, disabled: ctx.readOnly });
    box.checked = entry.done ?? false;
    box.addEventListener("change", () => ctx.end.post({ type: "setDone", id: ctx.data.space.id, dateId: entry.id, done: box.checked }));
    content.append(box);
  }
  if (entry.kind === "deadline" || entry.fromProject) content.append(
    renderElement("span", { class: "tl-deadline", role: "img", "aria-label": "Deadline", html: renderIcon("calendar") }));
  if (entry.progress) content.append(renderProgressMark(entry.progress.done, entry.progress.total),
    renderElement("span", { class: "tl-progress", text: `${entry.progress.done} / ${entry.progress.total} Done` }));
  content.append(renderElement("span", { class: entry.done ? "tl-done" : "tl-title", text: entry.title }));
  const date = ctx.data.space.dates.find(d => d.id === entry.id);
  if (!entry.fromProject && date) content.append(
    renderOverviewAction("Edit", () => edit(date), ctx.readOnly),
    renderOverviewAction("Remove", () => ctx.end.post({ type: "removeDate", id: ctx.data.space.id, dateId: entry.id }), ctx.readOnly));
  if (entry.fromProject) content.append(renderElement("span", { class: "ov-sub", text: "Project deadline" }));
  return row;
}
