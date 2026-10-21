// Builds the Overview card layout from the current Space snapshot.
import { el, emptyState, memberChip, positioned, sectionCard } from "../../../ui/dom/index.js";
import type { SpaceDate } from "../../model/index.js";
import type { OverviewContext } from "./context.js";
import { overviewAction } from "./actions.js";
import { timeline } from "./dates/index.js";
import { projectList, linkProject } from "./projects.js";
import { focusPapers } from "./focus.js";
export function overviewCards(ctx: OverviewContext, edit: (date?: SpaceDate) => void): HTMLElement {
  const add = overviewAction("Add date", () => edit(), ctx.readOnly);
  const dates = el("div");
  if (!ctx.data.overview.timeline.length) dates.append(emptyState({ inline: true, text: "No dates yet.", hint: "Add a task, a reading goal or a deadline, and the timeline appears." }));
  dates.append(timeline(ctx, date => edit(date)));
  const left = el("div", { class: "ov-col" },
    sectionCard({ title: "Dates and goals", actions: [add, overviewAction("Export .ics", () => ctx.end.post({ type: "exportIcs", id: ctx.data.space.id }))], body: dates }),
    sectionCard({ title: "Projects", actions: [overviewAction("Link", () => void linkProject(ctx), ctx.readOnly)], body: projectList(ctx) }),
    sectionCard({ title: "Papers in focus", body: focusPapers(ctx) }));
  const topic = overviewAction("Start a topic", () => {});
  positioned(topic, "Discussions need collaboration");
  const right = el("div", { class: "ov-col" },
    sectionCard({ title: "Members", body: el("div", {}, el("div", { class: "mem-row" }, memberChip("You"), "You"),
      emptyState({ inline: true, text: "Only you.", hint: "Share the Space to work on it with others." })) }),
    sectionCard({ title: "Discussions", actions: [topic], body: emptyState({ inline: true, text: "No open topics." }) }),
    sectionCard({ title: "Since your last visit", body: emptyState({ inline: true, text: "Nothing new since your last visit.", hint: "When others share this Space, what they add, edit and tick shows here." }) }));
  return el("div", { class: "ov-grid" }, left, right);
}
