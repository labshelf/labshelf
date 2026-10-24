// Composes the Space overview from planning and research panels.
import { el, emptyState, memberChip, positioned, sectionCard } from "../../../ui/dom/index.js";
import { paperPicker } from "../papers/index.js";
import type { SpaceDate } from "../../model/index.js";
import type { OverviewContext } from "./overviewContext.js";
import { overviewAction } from "./actions.js";
import { timeline } from "./timeline.js";
import { projectList, linkProject } from "./projects.js";
import { focusPapers } from "./focus.js";
export function overviewCards(ctx: OverviewContext, edit: (date?: SpaceDate) => void): HTMLElement {
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
