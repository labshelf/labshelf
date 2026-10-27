// Mounts the Space Overview with dialogs kept alive across refreshes, a date editor, and the timeline, actions and context it shares with other Space surfaces.
import type { SpaceDate } from "../model/index.js";
import { parseDateDraft, type HostToSpaces, type PaperPickItem, type SpacesTransport } from "../spacesProtocol.js";
import type { SpaceProjectEntry, TimelineEntry } from "../spaceViews.js";
import { renderElement, renderIcon, mountFormDialog, renderEmptyNotice, renderMemberChip, setPlannedNotice, renderSectionCard, renderProgressMark, pickQuickEntry, type IconName } from "../../ui/dom/index.js";
import { openPaperPicker } from "./mountSpacePapers.js";
import { renderReadingStatusMark } from "../../ui/icons/index.js";
import { formatDay } from "../../time/index.js";

export type SpaceSnapshot = Extract<HostToSpaces, { type: "space" }>;
export interface OverviewContext {
  data: SpaceSnapshot;
  end: SpacesTransport;
  readOnly: boolean;
  signal?: AbortSignal;
}

export function renderOverviewAction(label: string, onClick: () => void, disabled = false, glyph?: IconName): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: "ls-btn ls-btn-ghost", text: label, disabled });
  if (glyph) button.prepend(renderElement("span", { "aria-hidden": "true", html: renderIcon(glyph) }));
  button.addEventListener("click", onClick);
  return button;
}


function paperGoalFields(items: readonly PaperPickItem[], selected: ReadonlySet<string>): HTMLElement {
  const group = renderElement("fieldset", {}, renderElement("legend", { text: "Papers" }));
  const found = new Set(items.map(p => p.id));
  for (const p of [...items, ...[...selected].filter(id => !found.has(id)).map(id => ({ id, title: `${id} — Not in your Library` }))]) {
    const box = renderElement("input", { type: "checkbox", name: "paperIds", value: p.id });
    box.checked = selected.has(p.id);
    group.append(renderElement("label", {}, box, p.title));
  }
  if (!items.length && !selected.size) group.append(renderElement("p", { text: "No papers in your Library." }));
  return group;
}
function projectGoalFields(items: readonly SpaceProjectEntry[], selected?: string): HTMLElement {
  const select = renderElement("select", { class: "ls-input", name: "projectId", tabindex: "0" }, renderElement("option", { value: "", text: "Choose a project" }));
  for (const p of items) select.append(renderElement("option", { value: p.projectId, text: p.available ? p.title : `${p.title} — Not on this device` }));
  if (selected && !items.some(p => p.projectId === selected)) select.append(renderElement("option", { value: selected, text: `${selected} — Not on this device` }));
  select.value = selected ?? "";
  return renderElement("label", {}, "Project", select);
}

function dateFields(date?: SpaceDate) {
  const kind = renderElement("select", { class: "ls-input", name: "kind", tabindex: "0" });
  for (const [value, label] of [["task", "Task"], ["deadline", "Deadline"], ["read", "Reading goal"], ["project", "Project goal"]] as const) {
    kind.append(renderElement("option", { value, text: label }));
  }
  kind.value = date?.kind ?? "task";
  const title = renderElement("input", { class: "ls-input", name: "title", required: true, value: date?.title ?? "" });
  const day = renderElement("input", { class: "ls-input", name: "date", type: "date", required: true, value: date?.date ?? "" });
  const body = renderElement("div", { class: "sp-date-fields" },
    renderElement("label", {}, "Kind", kind), renderElement("label", {}, "Title", title), renderElement("label", {}, "Date", day));
  return { body, kind, title, day };
}

function openDateDialog(ctx: OverviewContext, date?: SpaceDate): () => void {
  const fields = dateFields(date);
  const goals = renderElement("div", { class: "sp-goal-fields" });
  const error = renderElement("p", { role: "alert" });
  const form = renderElement("form", { class: "ls-dialog sp-date-dialog", role: "dialog", "aria-modal": "true", "aria-label": date ? "Edit date" : "Add date" },
    renderElement("h2", { text: date ? "Edit date" : "Add date" }), fields.body, goals, error);
  const selected = new Set(date?.kind === "read" ? date.paperIds : []);
  let projectId = date?.kind === "project" ? date.projectId : undefined;
  let papers: readonly PaperPickItem[] = [];
  const paint = (): void => {
    goals.replaceChildren();
    if (fields.kind.value === "read") goals.append(paperGoalFields(papers, selected));
    if (fields.kind.value === "project") goals.append(projectGoalFields(ctx.data.projects, projectId));
  };
  goals.addEventListener("change", e => {
    const input = e.target as HTMLInputElement;
    if (input.name === "paperIds") { if (input.checked) selected.add(input.value); else selected.delete(input.value); }
    if (input.name === "projectId") projectId = input.value || undefined;
  });
  fields.kind.addEventListener("change", paint);
  const unsubscribe = ctx.end.subscribe(message => {
    if (message.type === "papers") { papers = message.items; paint(); }
  });
  const close = mountFormDialog(form, { submitLabel: "Save", unsubscribe });
  form.addEventListener("submit", event => {
    event.preventDefault();
    const draft = parseDateDraft({ kind: fields.kind.value, title: fields.title.value.trim(), date: fields.day.value,
      done: date?.kind === "task" ? date.done : false, paperIds: [...selected], projectId });
    if (!draft) { error.textContent = "Enter a title and a valid date."; return; }
    ctx.end.post(date ? { type: "updateDate", id: ctx.data.space.id, dateId: date.id, date: draft }
      : { type: "addDate", id: ctx.data.space.id, date: draft });
    close();
  });
  paint(); fields.title.focus(); ctx.end.post({ type: "listPapers" });
  return close;
}

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

function renderTimeline(ctx: OverviewContext, edit: (date: SpaceDate) => void): HTMLElement {
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
