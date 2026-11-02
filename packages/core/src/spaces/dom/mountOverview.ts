// Mounts the Space Overview (the desk of papers in focus, the dates up next and the linked projects) with a date editor and dialogs kept alive across refreshes.
import type { SpaceDate } from "../space.js";
import { parseDateDraft, type HostToSpaces, type PaperPickItem, type SpacesTransport } from "../spacesProtocol.js";
import type { SpaceProjectEntry, TimelineEntry } from "../spaceViews.js";
import { renderElement, renderIcon, mountFormDialog, renderEmptyNotice, renderProgressMark, pickQuickEntry, type IconName } from "../../ui/dom/index.js";
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
    const row = renderElement("div", { class: "ov-row ov-project" },
      renderElement("span", { class: "ov-glyph", "aria-hidden": "true", html: renderIcon("file-text") }), open,
      renderElement("span", { class: "ov-sub ov-context", text: p.available ? [p.format, p.mainFile].filter(Boolean).join(" · ") : "Not on this device" }));
    const side = renderElement("div", { class: "ov-side" });
    if (p.checklist) side.append(renderElement("span", { class: "ov-check" }, renderProgressMark(p.checklist.done, p.checklist.total),
      renderElement("span", { class: "ov-sub", text: `${p.checklist.done} / ${p.checklist.total} Done` })));
    if (p.deadline) side.append(renderElement("time", { class: "ov-sub", datetime: p.deadline, text: `Due ${formatDay(p.deadline)}` }));
    const unlink = renderOverviewAction("Unlink", () => ctx.end.post({ type: "unlinkProject", id: ctx.data.space.id, projectId: p.projectId }), ctx.readOnly);
    unlink.classList.add("ov-hover");
    row.append(side, unlink, renderElement("span", { class: "ov-arrow", "aria-hidden": "true", html: renderIcon("arrow-right") }));
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

const STATUS_LABEL = { done: "Done", reading: "Reading", unread: "Unread" } as const;
let nextDescription = 0;
/** One card per paper in focus: a page-like preview over a footer naming the paper. */
function deskCards(ctx: OverviewContext): HTMLElement {
  const desk = renderElement("div", { class: "ov-desk" });
  for (const paper of ctx.data.overview.focus) {
    if (paper.missing) {
      desk.append(renderElement("div", { class: "ov-card missing" },
        renderElement("div", { class: "ov-page" }, renderElement("span", { class: "ov-page-note", text: `${paper.id} — Not in your Library` })),
        renderElement("div", { class: "ov-foot" }, renderElement("span", { class: "ov-glyph", "aria-hidden": "true", html: renderIcon("file-minus") }),
          renderElement("span", { class: "ov-main ov-sub", text: "Not in your Library" }),
          renderOverviewAction("Remove", () => ctx.end.post({ type: "removePaper", id: ctx.data.space.id, paperId: paper.id }), ctx.readOnly))));
      continue;
    }
    const status = STATUS_LABEL[paper.status];
    const byline = [...paper.authors, paper.year].filter(Boolean).join(" · ");
    const descriptionId = `ls-space-focus-${++nextDescription}`;
    const open = renderOverviewAction(paper.title, () => ctx.end.post({ type: "openPaper", paperId: paper.id }));
    open.classList.add("ov-card");
    open.setAttribute("aria-label", paper.title); open.setAttribute("aria-describedby", descriptionId); open.title = paper.title;
    open.replaceChildren(
      renderElement("span", { class: "ov-page", "aria-hidden": "true" }, renderElement("span", { class: "ov-page-title", text: paper.title }),
        byline ? renderElement("span", { class: "ov-page-byline", text: byline }) : ""),
      renderElement("span", { class: "ov-foot" }, renderElement("span", { class: "ov-glyph", "aria-hidden": "true", html: renderReadingStatusMark(paper.status) }),
        renderElement("span", { class: "ov-main" }, renderElement("span", { class: "ov-name", text: paper.title }),
          renderElement("span", { id: descriptionId, class: `ov-sub ov-status ${paper.status}`, text: `Paper · ${status}` })),
        renderElement("span", { class: "ov-arrow", "aria-hidden": "true", html: renderIcon("arrow-right") })));
    open.addEventListener("focus", () => ctx.end.post({ type: "selectPaper", paperId: paper.id }));
    desk.append(open);
  }
  if (!desk.childElementCount) desk.append(renderEmptyNotice({ inline: true, text: "Nothing on your desk.", hint: "Add the papers you are working on, and they stay here." }));
  return desk;
}

function section(title: string, actions: HTMLElement[], body: HTMLElement, kind: string): HTMLElement {
  const id = `ov-section-${kind}-${++nextDescription}`;
  return renderElement("section", { class: `ov-section ov-section-${kind}`, "aria-labelledby": id },
    renderElement("div", { class: "ov-section-head" }, renderElement("h2", { id, text: title }),
      actions.length ? renderElement("div", { class: "ov-section-actions" }, ...actions) : ""), body);
}

function overviewSections(ctx: OverviewContext, edit: (date?: SpaceDate) => void): HTMLElement {
  const next = renderElement("div");
  if (ctx.data.overview.timeline.length) next.append(renderTimeline(ctx, date => edit(date)));
  else next.append(renderEmptyNotice({ inline: true, text: "Nothing up next.", hint: "Add a task, a reading goal or a deadline, and it appears here." }));
  return renderElement("div", { class: "ov-dash" },
    section("Your desk", [renderOverviewAction("Add papers", () => openPaperPicker(ctx), ctx.readOnly, "plus")], deskCards(ctx), "desk"),
    section("Up next", [renderOverviewAction("Export .ics", () => ctx.end.post({ type: "exportIcs", id: ctx.data.space.id }), false, "download"),
      renderOverviewAction("Add date", () => edit(), ctx.readOnly, "plus")], next, "next"),
    section("Linked projects", [renderOverviewAction("Link", () => void linkProject(ctx), ctx.readOnly, "link")], projectList(ctx), "projects"));
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
  const render = (): void => root.replaceChildren(overviewSections(ctx, edit));
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
const KIND_GLYPH: Record<TimelineEntry["kind"], IconName> = { task: "check-square", read: "book-open", project: "file-text", deadline: "calendar" };
const KIND_LABEL: Record<TimelineEntry["kind"], string> = { task: "Task", read: "Reading goal", project: "Project goal", deadline: "Deadline" };
function whenText(entry: TimelineEntry): string {
  if (entry.overdue) return "Overdue";
  if (entry.when === "today") return "Today";
  return `${Math.abs(entry.daysAway)} days ${entry.when === "past" ? "ago" : "away"}`;
}
function timelineRow(entry: TimelineEntry, ctx: OverviewContext, edit: (date: SpaceDate) => void): HTMLElement {
  const row = renderElement("li", { class: `tl-row ${entry.when}` });
  const lead = renderElement("span", { class: "tl-lead" });
  if (entry.kind === "task") {
    const box = renderElement("input", { type: "checkbox", "aria-label": entry.title, disabled: ctx.readOnly });
    box.checked = entry.done ?? false;
    box.addEventListener("change", () => ctx.end.post({ type: "setDone", id: ctx.data.space.id, dateId: entry.id, done: box.checked }));
    lead.append(box);
  } else {
    const deadline = entry.kind === "deadline" || entry.fromProject;
    lead.append(renderElement("span", { class: deadline ? "tl-deadline" : "tl-glyph", role: "img", "aria-label": deadline ? "Deadline" : KIND_LABEL[entry.kind],
      html: renderIcon(deadline ? "calendar" : KIND_GLYPH[entry.kind]) }));
  }
  const context = renderElement("span", { class: "tl-context" });
  if (entry.progress) context.append(renderProgressMark(entry.progress.done, entry.progress.total),
    renderElement("span", { class: "tl-progress", text: `${entry.progress.done} / ${entry.progress.total} Done` }));
  else context.append(renderElement("span", { text: entry.fromProject ? "Project deadline" : KIND_LABEL[entry.kind] }));
  row.append(lead, renderElement("span", { class: entry.done ? "tl-title tl-done" : "tl-title", text: entry.title }), context);
  const actions = renderElement("span", { class: "tl-actions" });
  const date = ctx.data.space.dates.find(d => d.id === entry.id);
  if (!entry.fromProject && date) actions.append(
    renderOverviewAction("Edit", () => edit(date), ctx.readOnly),
    renderOverviewAction("Remove", () => ctx.end.post({ type: "removeDate", id: ctx.data.space.id, dateId: entry.id }), ctx.readOnly));
  row.append(actions, renderElement("span", { class: "tl-day" },
    renderElement("time", { datetime: entry.date, title: entry.date, text: entry.when === "today" ? "Today" : formatDay(entry.date) }),
    entry.when === "today" ? "" : renderElement("span", { class: entry.overdue ? "tl-when late" : "tl-when", text: whenText(entry) })));
  return row;
}
