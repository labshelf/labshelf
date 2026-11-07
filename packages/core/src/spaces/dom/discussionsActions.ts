// Turns a Discussions message into what the Space keeps (a quote in the reply, a saved message, an agreement, a task, a meeting) and holds their dialogs.
import { mountFormDialog, renderElement } from "../../ui/dom/index.js";
import { parseDateDraft } from "../parseSpaceDrafts.js";
import type { SpaceAgreement, SpaceDate, SpaceMeetingDate, SpaceSourceRef, SpaceTaskDate } from "../space.js";
import { formatDay } from "../../time/index.js";
import type { SpaceQmdItem } from "../spaceNotesStore.js";
import type { OverviewContext } from "./mountOverview.js";
import { plainText } from "../discussionText.js";

/** How long a default title or agreement text taken from a message may be. */
const EXCERPT_LENGTH = 120;
const QUOTE_LENGTH = 80;

/** What the actions need of the Discussions tab. */
export interface DiscussionsActionsHost {
  readonly ctx: OverviewContext;
  /** The names seen as authors so far, the user's own first. */
  people(): string[];
  /** Puts a quote of the message at the top of the draft and focuses the composer. */
  quote(item: SpaceQmdItem): void;
}

const cut = (text: string, length: number): string => (text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text);


export const excerptOf = (body: string, length = EXCERPT_LENGTH): string => cut(plainText(body), length);
/** The default text of a record made from a message: like excerptOf, but its math stays TeX, so the record keeps what was said. */
const draftOf = (body: string): string => cut(plainText(body, true), EXCERPT_LENGTH);

/** `> **Author** · first line…`, then a blank line, for the top of a reply. */
export function quoteOf(item: SpaceQmdItem): string {
  const first = plainText(item.body.split(/\r?\n/).find((line) => line.trim() !== "" && !line.startsWith("```")) ?? "");
  return `> **${item.author ?? "Unknown"}** · ${cut(first, QUOTE_LENGTH)}\n\n`;
}

const QUOTE_LINE = /^> \*\*(.+?)\*\* · (.*)\r?\n(?:\r?\n)?/;

/** Splits a reply into the quote `quoteOf` put at its top and the rest; the editor cannot typeset a blockquote, so the chat draws it. */
export function splitQuote(body: string): { quote?: { author: string; text: string }; rest: string } {
  const match = QUOTE_LINE.exec(body);
  return match ? { quote: { author: match[1]!, text: match[2]! }, rest: body.slice(match[0].length) } : { rest: body };
}

export const isMeeting = (date: SpaceDate): date is SpaceMeetingDate => date.kind === "meeting";
export const isTask = (date: SpaceDate): date is SpaceTaskDate => date.kind === "task";
export const sourceOf = (date: SpaceDate): SpaceSourceRef | undefined => (isMeeting(date) || isTask(date) ? date.source : undefined);
const sameRef = (a: SpaceSourceRef | undefined, b: SpaceSourceRef): boolean => a?.path === b.path && a.itemId === b.itemId;

/** The agreements, tasks and meetings made from one message, and whether `me` saved it. */
export function recordsOfMessage(ctx: OverviewContext, ref: SpaceSourceRef) {
  const { space } = ctx.data;
  return {
    saved: (space.saved ?? []).some((entry) => entry.by === ctx.data.author && sameRef(entry, ref)),
    agreements: (space.agreements ?? []).filter((entry) => sameRef(entry, ref)),
    tasks: space.dates.filter(isTask).filter((date) => sameRef(date.source, ref)),
    meetings: space.dates.filter(isMeeting).filter((date) => sameRef(date.source, ref)),
  };
}

/** `Mon, 3 Nov · 14:00–15:00`, or the day alone without times. */
export function meetingWhen(meeting: SpaceMeetingDate): string {
  const times = meeting.start ? ` · ${meeting.start}${meeting.end ? `–${meeting.end}` : ""}` : "";
  return `${formatDay(meeting.date)}${times}`;
}

const spaceIdOf = (ctx: OverviewContext): string => ctx.data.space.id;

/** Mounts a dialog of `fields`; `submit` posts and returns nothing, or returns the error to show. */
function openRecordDialog(ctx: OverviewContext, title: string, fields: HTMLElement[], submit: () => string | undefined): () => void {
  const error = renderElement("p", { role: "alert" });
  const form = renderElement("form", { class: "ls-dialog ds-dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
    renderElement("h2", { text: title }), ...fields, error);
  const close = mountFormDialog(form, { submitLabel: "Save", ...(ctx.signal ? { signal: ctx.signal } : {}) });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const problem = submit();
    if (problem === undefined) close(); else error.textContent = problem;
  });
  form.querySelector<HTMLElement>("input, textarea")?.focus();
  return close;
}

const field = (label: string, input: HTMLElement): HTMLElement => renderElement("label", {}, label, input);
const textInput = (name: string, value = "", attrs: Record<string, string | boolean> = {}): HTMLInputElement =>
  renderElement("input", { class: "ls-input", name, value, ...attrs });

/** New when `agreement` is absent: its text defaults to the message's excerpt. */
export function openAgreementDialog(ctx: OverviewContext, source: SpaceSourceRef & { body?: string }, agreement?: SpaceAgreement): () => void {
  const text = renderElement("textarea", { class: "ls-input", name: "text", rows: "4", required: true });
  text.value = agreement?.text ?? draftOf(source.body ?? "");
  return openRecordDialog(ctx, agreement ? "Edit agreement" : "Record agreement", [field("Agreement", text)], () => {
    if (!text.value.trim()) return "Enter what was agreed.";
    ctx.end.post(agreement ? { type: "updateAgreement", id: spaceIdOf(ctx), agreementId: agreement.id, text: text.value.trim() }
      : { type: "addAgreement", id: spaceIdOf(ctx), agreement: { path: source.path, itemId: source.itemId, text: text.value.trim() } });
    return undefined;
  });
}

/** Posts the date as new, or in place of `old`; returns the error to show when the fields do not make a date. */
function postDate(ctx: OverviewContext, raw: Record<string, unknown>, old: { id: string } | undefined, problem: string): string | undefined {
  const draft = parseDateDraft(raw);
  if (!draft) return problem;
  ctx.end.post(old ? { type: "updateDate", id: spaceIdOf(ctx), dateId: old.id, date: draft } : { type: "addDate", id: spaceIdOf(ctx), date: draft });
  return undefined;
}

let nextList = 0;

/** New from the message `source` when `task` is absent; the assignee suggests the people seen so far. */
export function openTaskDialog(host: DiscussionsActionsHost, source: (SpaceSourceRef & { body?: string }) | undefined, task?: SpaceTaskDate): () => void {
  const listId = `ds-people-${++nextList}`;
  const title = textInput("title", task?.title ?? draftOf(source?.body ?? ""), { required: true });
  const assignee = textInput("assignee", task?.assignee ?? "", { list: listId, autocomplete: "off" });
  const due = textInput("date", task?.date ?? "", { type: "date", required: true });
  const people = renderElement("datalist", { id: listId }, ...host.people().map((name) => renderElement("option", { value: name })));
  const ref = task?.source ?? (source && { path: source.path, itemId: source.itemId });
  return openRecordDialog(host.ctx, task ? "Edit task" : "Create task", [field("Title", title), field("Assignee", assignee), people, field("Due date", due)],
    () => postDate(host.ctx, { kind: "task", title: title.value.trim(), date: due.value, done: task?.done ?? false, assignee: assignee.value, source: ref },
      task, "Enter a title and a due date."));
}

function participantFields(people: readonly string[], chosen: ReadonlySet<string>): HTMLElement {
  const group = renderElement("fieldset", { class: "ds-participants" }, renderElement("legend", { text: "Participants" }));
  for (const name of [...new Set([...people, ...chosen])]) {
    const box = renderElement("input", { type: "checkbox", name: "participants", value: name });
    box.checked = chosen.has(name);
    group.append(renderElement("label", {}, box, name));
  }
  return group;
}

/** New from the message `source` when `meeting` is absent. */
export function openMeetingDialog(host: DiscussionsActionsHost, source: (SpaceSourceRef & { body?: string }) | undefined, meeting?: SpaceMeetingDate): () => void {
  const title = textInput("title", meeting?.title ?? draftOf(source?.body ?? ""), { required: true });
  const day = textInput("date", meeting?.date ?? "", { type: "date", required: true });
  const start = textInput("start", meeting?.start ?? "", { type: "time" });
  const end = textInput("end", meeting?.end ?? "", { type: "time" });
  const participants = participantFields(host.people(), new Set(meeting?.participants ?? []));
  const agenda = renderElement("textarea", { class: "ls-input", name: "agenda", rows: "3" });
  agenda.value = meeting?.agenda ?? "";
  const ref = meeting?.source ?? (source && { path: source.path, itemId: source.itemId });
  const fields = [field("Title", title), field("Date", day),
    renderElement("div", { class: "ds-times" }, field("Start", start), field("End", end)), participants, field("Agenda", agenda)];
  return openRecordDialog(host.ctx, meeting ? "Edit meeting" : "Schedule meeting", fields, () => {
    const chosen = [...participants.querySelectorAll<HTMLInputElement>("input:checked")].map((box) => box.value);
    return postDate(host.ctx, {
      kind: "meeting", title: title.value.trim(), date: day.value, source: ref, agenda: agenda.value,
      ...(start.value ? { start: start.value } : {}), ...(end.value ? { end: end.value } : {}), ...(chosen.length ? { participants: chosen } : {}),
    }, meeting, "Enter a title, a date, and an end after the start.");
  });
}
