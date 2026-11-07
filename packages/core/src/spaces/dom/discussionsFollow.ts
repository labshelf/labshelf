// Renders the Follow up panel of the Discussions tab (next meeting, open tasks, recent agreements, for the Space or one conversation)
// and the detail of one of them, with the message it came from.
import { askDialog, renderElement, renderEmptyNotice, type IconName } from "../../ui/dom/index.js";
import { formatClockTime, formatDay, formatShortDate } from "../../time/index.js";
import type { SpaceAgreement, SpaceDate, SpaceSourceRef, SpaceTaskDate } from "../space.js";
import type { SpaceQmdItem } from "../spaceNotesStore.js";
import {
  isMeeting, isTask, meetingWhen, openAgreementDialog, openMeetingDialog, openTaskDialog, sourceOf, type DiscussionsActionsHost,
} from "./discussionsActions.js";
import { renderIconButton, renderIconSpan, renderInitial } from "./discussionsViews.js";

export type FollowScope = "space" | "conversation";
export type FollowRecord = { kind: "meeting" | "task" | "agreement"; id: string };

/** What the panel needs of the Discussions tab. */
export interface FollowHost extends DiscussionsActionsHost {
  readonly scope: FollowScope;
  readonly detail: FollowRecord | undefined;
  /** The open conversation, if any. */
  readonly selected: string | undefined;
  titleOf(path: string): string;
  itemOf(ref: SpaceSourceRef): SpaceQmdItem | undefined;
  setScope(scope: FollowScope): void;
  show(detail: FollowRecord | undefined): void;
  close(): void;
  openSource(ref: SpaceSourceRef): void;
}

function section(name: IconName, title: string, ...content: Array<HTMLElement | string>): HTMLElement {
  return renderElement("section", { class: "ds-follow-section", "aria-label": title }, renderElement("h3", {}, renderIconSpan(name), title), ...content);
}

function openButton(text: string, onClick: () => void, className = "ds-follow-open"): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: className, text });
  button.addEventListener("click", onClick);
  return button;
}

function taskRow(host: FollowHost, task: SpaceTaskDate, today: string): HTMLElement {
  const { ctx } = host;
  const box = renderElement("input", { type: "checkbox", "aria-label": task.title, disabled: ctx.readOnly });
  box.addEventListener("change", () => ctx.end.post({ type: "setDone", id: ctx.data.space.id, dateId: task.id, done: box.checked }));
  const late = task.date < today;
  const meta = [task.assignee, late ? `Overdue · ${formatDay(task.date)}` : formatDay(task.date), task.source && host.titleOf(task.source.path)].filter(Boolean).join(" · ");
  return renderElement("li", { class: "ds-follow-item" }, box, renderElement("span", { class: "ds-follow-text" },
    openButton(task.title, () => host.show({ kind: "task", id: task.id })), renderElement("span", { class: late ? "late" : "", text: meta })));
}

/** The next meeting, else the next dated item; a meeting opens its detail from the whole row. */
function nextMeeting(host: FollowHost, dates: readonly SpaceDate[], today: string): HTMLElement {
  const ahead = dates.filter((date) => date.date >= today && !(isTask(date) && date.done)).sort((a, b) => a.date.localeCompare(b.date));
  const next = ahead.find(isMeeting) ?? ahead.find((date) => !isTask(date));
  if (!next) return renderEmptyNotice({ text: "No meetings ahead.", inline: true });
  const meeting = isMeeting(next) ? next : undefined;
  const source = meeting?.source && host.titleOf(meeting.source.path);
  const text = renderElement("span", { class: "ds-follow-text" }, renderElement("strong", { text: next.title }),
    renderElement("span", { text: meeting ? meetingWhen(meeting) : formatDay(next.date) }), source ? renderElement("span", { text: source }) : "");
  if (!meeting) return renderElement("div", { class: "ds-follow-item" }, text);
  const row = renderElement("button", { type: "button", class: "ds-follow-item ds-follow-next", "aria-label": `${next.title}, view details` }, text, renderIconSpan("chevron-left", "ds-icon ds-chevron"));
  row.addEventListener("click", () => host.show({ kind: "meeting", id: next.id }));
  return row;
}

function agreementRow(host: FollowHost, agreement: SpaceAgreement): HTMLElement {
  const view = openButton("View source", () => host.openSource(agreement), "ds-link");
  view.append(renderIconSpan("external"));
  return renderElement("li", { class: "ds-follow-item" }, renderIconSpan("check", "ds-icon ds-check"), renderElement("span", { class: "ds-follow-text" },
    openButton(agreement.text, () => host.show({ kind: "agreement", id: agreement.id })),
    renderElement("span", { text: `${host.titleOf(agreement.path)} · Recorded by ${agreement.by} · ${formatShortDate(agreement.created)}` }), view));
}

function scopeSelect(host: FollowHost): HTMLElement | string {
  if (host.selected === undefined) return "";
  const select = renderElement("select", { class: "ls-input ds-scope", "aria-label": "Follow up scope" },
    renderElement("option", { value: "space", text: "Whole Space" }), renderElement("option", { value: "conversation", text: "This conversation" }));
  select.value = host.scope;
  select.addEventListener("change", () => host.setScope(select.value as FollowScope));
  return select;
}

function overviewBody(host: FollowHost, today: string): HTMLElement[] {
  const { space } = host.ctx.data;
  const scoped = host.scope === "conversation" && host.selected !== undefined ? host.selected : undefined;
  const inScope = (ref: SpaceSourceRef | undefined): boolean => scoped === undefined || ref?.path === scoped;
  const dates = space.dates.filter((date) => inScope(sourceOf(date)));
  const tasks = dates.filter(isTask).filter((task) => !task.done).sort((a, b) => a.date.localeCompare(b.date));
  const agreements = (space.agreements ?? []).filter(inScope).sort((a, b) => b.created.localeCompare(a.created));
  return [
    section("calendar", "Next meeting", nextMeeting(host, dates, today)),
    section("check-square", `Open tasks (${tasks.length})`, tasks.length
      ? renderElement("ul", { class: "ds-follow-list" }, ...tasks.map((task) => taskRow(host, task, today)))
      : renderEmptyNotice({ text: "No open tasks.", inline: true })),
    section("check", `Recent agreements (${agreements.length})`, agreements.length
      ? renderElement("ul", { class: "ds-follow-list" }, ...agreements.map((agreement) => agreementRow(host, agreement)))
      : renderEmptyNotice({ text: "No agreements yet.", hint: "Record agreement on a message lists it here.", inline: true })),
  ];
}

const detailRow = (label: string, ...value: Array<HTMLElement | string>): HTMLElement =>
  renderElement("div", { class: "ds-detail-row" }, renderElement("dt", { text: label }), renderElement("dd", {}, ...value));

function originRows(host: FollowHost, ref: SpaceSourceRef | undefined, fallback?: { by: string; created: string }): HTMLElement[] {
  if (!ref) return [];
  const item = host.itemOf(ref);
  const who = item?.author ?? fallback?.by;
  const when = item?.created ?? fallback?.created;
  const view = openButton("View source message", () => host.openSource(ref), "ds-link");
  view.append(renderIconSpan("external"));
  return [detailRow("Origin", renderElement("span", { class: "ds-origin" }, renderIconSpan("message"), renderElement("span", { class: "ds-follow-text" },
    renderElement("strong", { text: host.titleOf(ref.path) }),
    renderElement("span", { text: [who, when && `${formatShortDate(when)} ${formatClockTime(when)}`].filter(Boolean).join(" · ") }), view)))];
}

type Detail = { title: string; kind: string; icon: IconName; rows: HTMLElement[]; footer?: string; edit: () => void; remove: () => void };

const personName = (host: FollowHost, name: string): string => (name === host.ctx.data.author ? "You" : name);

function describe(host: FollowHost, record: FollowRecord): Detail | undefined {
  const { ctx } = host;
  const id = ctx.data.space.id;
  const removeDate = (dateId: string) => () => ctx.end.post({ type: "removeDate", id, dateId });
  if (record.kind === "agreement") {
    const agreement = (ctx.data.space.agreements ?? []).find((entry) => entry.id === record.id);
    return agreement && { title: agreement.text, kind: "Agreement", icon: "check", rows: [detailRow("Recorded", formatShortDate(agreement.created)),
      ...originRows(host, agreement, agreement)], footer: `Recorded by ${agreement.by === ctx.data.author ? "you" : agreement.by}`,
    edit: () => openAgreementDialog(ctx, agreement, agreement), remove: () => ctx.end.post({ type: "removeAgreement", id, agreementId: record.id }) };
  }
  const date = ctx.data.space.dates.find((entry) => entry.id === record.id);
  if (date && isMeeting(date)) {
    return { title: date.title, kind: "Meeting", icon: "calendar", rows: [detailRow("When", meetingWhen(date)),
      detailRow("Participants", ...(date.participants?.length
        ? date.participants.map((name) => renderElement("span", { class: "ds-person" }, renderInitial(name), personName(host, name))) : ["None"])),
      ...(date.agenda ? [detailRow("Agenda", renderElement("p", { class: "ds-agenda", text: date.agenda }))] : []), ...originRows(host, date.source)],
    edit: () => openMeetingDialog(host, undefined, date), remove: removeDate(date.id) };
  }
  if (date && isTask(date)) {
    return { title: date.title, kind: "Task", icon: "check-square", rows: [detailRow("Due", formatDay(date.date)),
      detailRow("Assignee", date.assignee ? personName(host, date.assignee) : "Nobody"), detailRow("Status", date.done ? "Done" : "Open"), ...originRows(host, date.source)],
    edit: () => openTaskDialog(host, undefined, date), remove: removeDate(date.id) };
  }
  return undefined;
}

function detailBody(host: FollowHost, record: FollowRecord): Array<HTMLElement | string> {
  const detail = describe(host, record);
  if (!detail) return [renderEmptyNotice({ text: "This item was removed.", inline: true })];
  const edit = renderIconButton("edit", "Edit", "ds-btn ds-wide");
  edit.addEventListener("click", detail.edit);
  const remove = openButton("Remove", () => {
    void askDialog("Remove", `Remove "${detail.title}"?`, "Remove", true).then((yes) => { if (yes && !host.ctx.readOnly) { detail.remove(); host.show(undefined); } });
  }, "ds-remove");
  edit.disabled = remove.disabled = host.ctx.readOnly;
  return [renderElement("div", { class: "ds-detail-head" }, renderIconSpan(detail.icon, "ds-icon ds-detail-icon"),
    renderElement("div", {}, renderElement("h3", { class: "ds-detail-title", text: detail.title }), renderElement("span", { class: "ds-status", text: detail.kind }))),
  renderElement("dl", { class: "ds-detail-list" }, ...detail.rows), renderElement("div", { class: "ds-detail-actions" }, edit, remove),
  detail.footer ? renderElement("p", { class: "ds-detail-foot", text: detail.footer }) : ""];
}

/** The panel: the overview of the scope under the title, or the detail of `host.detail` with a way back. */
export function renderFollowPanel(host: FollowHost, today: string): HTMLElement {
  const close = renderIconButton("x", "Close Follow up", "ds-icon-btn", true);
  close.addEventListener("click", () => host.close());
  const record = host.detail;
  const back = renderIconButton("arrow-left", "Follow up", "ds-back");
  back.addEventListener("click", () => host.show(undefined));
  const head = record
    ? renderElement("header", { class: "ds-follow-head" }, back, close)
    : renderElement("header", { class: "ds-follow-head" }, renderElement("h2", { text: "Follow up" }), close);
  return renderElement("aside", { class: "ds-follow", "aria-label": "Follow up" }, head, ...(record ? detailBody(host, record) : [scopeSelect(host), ...overviewBody(host, today)]));
}
