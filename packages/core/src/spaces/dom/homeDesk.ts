// Renders the Home desk: a horizontal strip of pinned cards and personal tasks with their previews, the "+ Pin item" menu, the pickers with a reminder, and the new-task dialog.
import { renderElement, renderIcon, pickQuickEntry, mountFormDialog, showMenu, showToast, type IconName } from "../../ui/dom/index.js";
import type { HomeAction, HostToSpaces, SpacesTransport } from "../spacesProtocol.js";
import { parseHomeTaskInput, type HomePin } from "../homeFile.js";
import type { HomeDeskCard, HomeView } from "../homeView.js";
import { renderSpaceIcon } from "../../ui/icons/index.js";

export interface HomeContext {
  readonly end: SpacesTransport;
  view: HomeView;
  readonly signal: AbortSignal;
  /** The month the Up next calendar shows (YYYY-MM) and the day it filters to. */
  calendar: { month?: string; day?: string | undefined };
}

export const notYet = (): void => { showToast("Still in development.", "info"); };
const STATUS_LABEL = { done: "Read", reading: "Reading", unread: "Unread" } as const;

function iconButton(icon: IconName, label: string, onClick: (button: HTMLButtonElement) => void, className = "ls-icon-btn"): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: className, title: label, "aria-label": label, html: renderIcon(icon) });
  button.addEventListener("click", (event) => { event.stopPropagation(); onClick(button); });
  return button;
}

/** "in 3 days", "Today", "2 days late". */
export function relativeDay(daysAway: number): string {
  if (daysAway === 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  if (daysAway < 0) return `${-daysAway} ${daysAway === -1 ? "day" : "days"} late`;
  return `in ${daysAway} days`;
}

/** "Nov 12" for a YYYY-MM-DD day. */
export function shortDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const readOnly = (ctx: HomeContext): boolean => ctx.view.readOnlyReason !== undefined;
const post = (ctx: HomeContext, message: HomeAction): void => { if (!readOnly(ctx)) ctx.end.post(message); };
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

function openLink(ctx: HomeContext, kind: "paper" | "project" | "space", ref: string): void {
  if (kind === "paper") ctx.end.post({ type: "openPaper", paperId: ref });
  else if (kind === "project") ctx.end.post({ type: "openProject", projectId: ref });
  else ctx.end.post({ type: "openSpace", id: ref, tab: "overview" });
}

/** The ⋯ menu of a card: Unpin, and Edit reminder for a pin. */
function cardMenu(ctx: HomeContext, c: HomeDeskCard, label: string): HTMLButtonElement {
  return iconButton("more", "More actions", (button) => showMenu(button, [
    ...(c.kind === "task" ? [{ label: "Mark done", icon: "check" as const, disabled: readOnly(ctx), onSelect: () => completeTask(ctx, c.id) }] :[{ label: "Edit reminder…", icon: "tag" as const, disabled: readOnly(ctx), onSelect: () => openReminderDialog(ctx, label, c.note, (note) => post(ctx, { type: "home.setNote", id: c.id, ...(note ? { note } : {}) })) }]),
    { label: c.kind === "task" ? "Remove task" : "Unpin", icon: c.kind === "task" ? "x" : "pin", disabled: readOnly(ctx), onSelect: () => post(ctx, { type: "home.unpin", id: c.id }) },
  ]), "ls-icon-btn hm-card-more");
}

const completeTask = (ctx: HomeContext, id: string): void => post(ctx, { type: "home.completeTask", id });

interface CardParts {
  readonly top: HTMLElement;
  readonly foot: Array<HTMLElement | string>;
  readonly open?: () => void;
  readonly missing?: boolean;
  /** Shows the pin mark beside the ⋯ menu. */
  readonly pinned?: boolean;
}

function card(ctx: HomeContext, c: HomeDeskCard, label: string, parts: CardParts): HTMLElement {
  const tools = renderElement("div", { class: "hm-card-tools" },
    parts.pinned ? renderElement("span", { class: "hm-card-pin", title: "Pinned to your desk", html: renderIcon("pin") }) : "", cardMenu(ctx, c, label));
  const el = renderElement("article", { class: `hm-card hm-card-${c.kind}${parts.missing ? " missing" : ""}`, "aria-label": label },
    parts.top, renderElement("div", { class: "hm-card-foot" }, ...parts.foot), tools);
  const open = parts.open;
  if (open) {
    el.classList.add("hm-openable");
    el.tabIndex = 0;
    el.addEventListener("click", open);
    el.addEventListener("keydown", (event) => { if (event.key === "Enter" && event.target === el) open(); });
  }
  return el;
}

const kindLabel = (icon: string, text: string): HTMLElement =>
  renderElement("span", { class: "hm-kind" }, renderElement("span", { class: "hm-kind-glyph", "aria-hidden": "true", html: icon }), text);
const footText = (titleText: string, meta: string): HTMLElement => renderElement("span", { class: "hm-foot-text" },
  renderElement("strong", { class: "hm-foot-title", text: titleText, title: titleText }), renderElement("span", { class: "hm-foot-meta", text: meta }));
const footGlyph = (html: string): HTMLElement => renderElement("span", { class: "hm-foot-glyph", "aria-hidden": "true", html });
const arrow = (): HTMLElement => renderElement("span", { class: "hm-foot-arrow", "aria-hidden": "true", html: renderIcon("arrow-right") });
const accent = (text: string, onClick: () => void, disabled = false): HTMLButtonElement => {
  const button = renderElement("button", { type: "button", class: "hm-accent", text, disabled });
  button.addEventListener("click", (event) => { event.stopPropagation(); onClick(); });
  return button;
};
const reminder = (note: string | undefined): HTMLElement | "" => note
  ? renderElement("p", { class: "hm-reminder" }, renderElement("span", { "aria-hidden": "true", html: renderIcon("tag") }), renderElement("span", { text: note })) : "";

/** "Grigori Perelman" as "G. Perelman", the way a title page names its authors. */
function initialled(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length < 2 ? name : `${parts.slice(0, -1).map((part) => `${part[0]}.`).join(" ")} ${parts[parts.length - 1]}`;
}

/** One TeX line with commands, braces and comments tinted. */
function tintTex(line: string): Array<HTMLElement | string> {
  const out: Array<HTMLElement | string> = [];
  for (const [token] of line.matchAll(/%.*$|\\[A-Za-z@]+\*?|\\.|[{}[\]]|[^\\%{}[\]]+/g)) {
    const cls = token.startsWith("%") ? "c" : token.startsWith("\\") ? "k" : /^[{}[\]]$/.test(token) ? "b" : "";
    out.push(cls ? renderElement("span", { class: `hm-tex-${cls}`, text: token }) : token);
  }
  return out;
}

function paperCard(ctx: HomeContext, c: Extract<HomeDeskCard, { kind: "paper" }>): HTMLElement {
  const p = c.paper;
  if (p.missing) {
    const label = p.remote?.title ?? c.ref;
    return card(ctx, c, label, { missing: true,
      top: renderElement("div", { class: "hm-sheet" }, renderElement("span", { class: "hm-sheet-title", text: label })),
      foot: [footGlyph(renderIcon("file-minus")), footText(label, "Not in your Library")] });
  }
  const meta = p.authors.slice(0, 2).map(initialled).join(", ") + (p.authors.length > 2 ? " et al." : "");
  return card(ctx, c, p.title, {
    top: renderElement("div", { class: "hm-sheet", "aria-hidden": "true" }, renderElement("span", { class: "hm-sheet-title", text: p.title }),
      meta ? renderElement("span", { class: "hm-sheet-authors", text: meta }) : ""),
    foot: [footGlyph(renderIcon("file-text")), footText(p.title, `Paper · ${STATUS_LABEL[p.status]}`), arrow()],
    open: () => openLink(ctx, "paper", p.id),
  });
}

function projectCard(ctx: HomeContext, c: Extract<HomeDeskCard, { kind: "project" }>): HTMLElement {
  const p = c.project;
  const file = p.mainFile ?? (p.format === "typst" ? "main.typ" : "main.tex");
  const top = c.excerpt?.length
    ? renderElement("ol", { class: "hm-code", "aria-hidden": "true" }, ...c.excerpt.map((line) => renderElement("li", {}, ...(file.endsWith(".tex") ? tintTex(line) : [line]))))
    : renderElement("div", { class: "hm-code hm-code-empty" }, renderElement("span", { "aria-hidden": "true", html: renderIcon("file-text") }), file);
  const glyph = p.format === "typst" ? "<span class=\"hm-typ\">typ</span>" : "<span class=\"hm-tex\">T<sub>E</sub>X</span>";
  return card(ctx, c, p.title, {
    top, missing: !p.available,
    foot: [footGlyph(glyph), footText(p.title, p.available ? `Project · ${file}` : "Not on this device"), p.available ? arrow() : ""],
    ...(p.available ? { open: () => openLink(ctx, "project", p.projectId) } : {}),
  });
}

function spaceCard(ctx: HomeContext, c: Extract<HomeDeskCard, { kind: "space" }>): HTMLElement {
  const s = c.space;
  if (!s) {
    return card(ctx, c, c.ref, { missing: true, top: renderElement("div", { class: "hm-card-body" }, kindLabel(renderIcon("layers"), "Space"),
      renderElement("strong", { class: "hm-card-name", text: c.ref }), renderElement("span", { class: "hm-card-line", text: "This Space is gone" })), foot: [] });
  }
  const counts = [s.counts.papers ? plural(s.counts.papers, "paper") : "", c.notes ? plural(c.notes, "note") : "", s.counts.projects ? plural(s.counts.projects, "project") : ""].filter(Boolean);
  return card(ctx, c, s.name, {
    top: renderElement("div", { class: "hm-card-body" }, kindLabel(renderSpaceIcon(s.icon), "Space"),
      renderElement("strong", { class: "hm-card-name", text: s.name, title: s.name }),
      renderElement("span", { class: "hm-card-line", text: counts.join(" · ") || (s.purpose ?? "Empty Space") }),
      c.note ? renderElement("hr", { class: "hm-card-rule" }) : "", reminder(c.note)),
    foot: [renderElement("span", { class: "hm-foot-meta hm-grow", text: c.note ? "Personal reminder" : s.next ? `Next: ${shortDay(s.next.date)}` : "" }),
      accent("Enter Space →", () => openLink(ctx, "space", s.id))],
    open: () => openLink(ctx, "space", s.id),
    pinned: true,
  });
}

function taskCard(ctx: HomeContext, c: Extract<HomeDeskCard, { kind: "task" }>): HTMLElement {
  const due = c.date !== undefined && c.daysAway !== undefined
    ? renderElement("span", { class: `hm-due${c.daysAway < 0 ? " hm-late" : c.daysAway === 0 ? " hm-today" : ""}` },
      renderElement("span", { "aria-hidden": "true", html: renderIcon("calendar") }),
      renderElement("time", { datetime: c.date, text: c.daysAway < 0 ? `Due ${shortDay(c.date)} · ${relativeDay(c.daysAway)}` : c.daysAway === 0 ? "Due today" : `Due ${shortDay(c.date)}` }))
    : "";
  const link = c.link;
  return card(ctx, c, c.title, {
    top: renderElement("div", { class: "hm-card-body" }, kindLabel(renderIcon("check-square"), "Personal task"),
      renderElement("strong", { class: "hm-card-name", text: c.title, title: c.title }),
      c.description ? renderElement("span", { class: "hm-card-desc", text: c.description }) : "", due),
    foot: [renderElement("span", { class: "hm-foot-meta hm-grow", text: link ? link.title : "Only you · No Space", title: link?.title ?? "" }),
      link ? accent("Open →", () => openLink(ctx, link.kind, link.ref), link.missing) : accent("Mark done",() => completeTask(ctx, c.id), readOnly(ctx))],
  });
}

function itemCard(ctx: HomeContext, c: Extract<HomeDeskCard, { kind: "note" | "thread" }>): HTMLElement {
  const kind = c.kind === "note" ? "Note" : "Topic";
  const found = c.title !== undefined;
  const open = (): void => { ctx.end.post({ type: "openSpace", id: c.spaceId, tab: c.kind === "note" ? "notes" : "discussions" }); };
  return card(ctx, c, c.title ?? c.ref, {
    missing: !found,
    top: renderElement("div", { class: "hm-card-body" }, kindLabel(renderIcon(c.kind === "note" ? "file-text" : "message"), kind),
      renderElement("strong", { class: "hm-card-name", text: c.title ?? c.ref, title: c.title ?? c.ref }),
      renderElement("span", { class: "hm-card-line", text: found ? c.spaceName ?? c.spaceId : `${kind} not found` }), reminder(c.note)),
    foot: [renderElement("span", { class: "hm-foot-meta hm-grow", text: c.note ? "Personal reminder" : "" }), found ? accent("Open →", open) : ""],
    ...(found ? { open } : {}),
  });
}

function deskCard(ctx: HomeContext, c: HomeDeskCard): HTMLElement {
  switch (c.kind) {
    case "task": return taskCard(ctx, c);
    case "paper": return paperCard(ctx, c);
    case "project": return projectCard(ctx, c);
    case "space": return spaceCard(ctx, c);
    default: return itemCard(ctx, c);
  }
}

/** Waits for the first reply of one type to a list request. */
function request<T extends HostToSpaces["type"]>(ctx: HomeContext, ask: "listPapers" | "listProjects", type: T): Promise<Extract<HostToSpaces, { type: T }>> {
  return new Promise((resolve) => {
    const stop = ctx.end.subscribe((message) => { if (message.type === type) { stop(); resolve(message as Extract<HostToSpaces, { type: T }>); } });
    ctx.end.post({ type: ask });
  });
}

const pinned = (ctx: HomeContext, kind: string, ref: string): boolean => ctx.view.desk.some((c) => c.id === `${kind}:${ref}`);

/** A small dialog with the optional reminder; Enter submits, an empty field means no reminder. */
function openReminderDialog(ctx: HomeContext, subject: string, current: string | undefined, done: (note: string) => void, submitLabel = "Save"): void {
  const input = renderElement("input", { class: "ls-input", name: "note", value: current ?? "", placeholder: "A note to yourself, shown on the card" });
  const form = renderElement("form", { class: "ls-dialog hm-dialog", role: "dialog", "aria-modal": "true", "aria-label": submitLabel === "Save" ? "Edit reminder" : "Pin to Home" },
    renderElement("h2", { text: submitLabel === "Save" ? "Edit reminder" : `Pin “${subject}”` }),
    renderElement("label", {}, "Reminder (optional)", input));
  const close = mountFormDialog(form, { submitLabel, signal: ctx.signal });
  form.addEventListener("submit", (event) => { event.preventDefault(); done(input.value.trim()); close(); });
  input.focus();
}

async function pick(ctx: HomeContext, kind: "paper" | "project" | "space"): Promise<void> {
  const entries = kind === "paper"
    ? (await request(ctx, "listPapers", "papers")).items.map((p) => ({ label: p.title, description: p.authors.join(", "), icon: "book-open" as const, value: p.id }))
    : kind === "project"
      ? (await request(ctx, "listProjects", "projects")).items.filter((p) => p.available).map((p) => ({ label: p.title, icon: "file" as const, value: p.projectId, ...(p.mainFile ? { description: p.mainFile } : {}) }))
      : ctx.view.spaces.map((s) => ({ label: s.name, icon: "layers" as const, value: s.id }));
  const free = entries.filter((entry) => !pinned(ctx, kind, entry.value));
  const ref = await pickQuickEntry(free, { title: `Pin a ${kind === "space" ? "Space" : kind}`, signal: ctx.signal });
  if (!ref || ctx.signal.aborted) return;
  const item: HomePin = { kind, ref };
  const subject = free.find((entry) => entry.value === ref)?.label ?? ref;
  openReminderDialog(ctx, subject, undefined, (note) => post(ctx, { type: "home.pin", item, ...(note ? { note } : {}) }), "Pin");
}

function openTaskDialog(ctx: HomeContext, papers: readonly { id: string; title: string }[], projects: readonly { projectId: string; title: string }[]): void {
  const name = renderElement("input", { class: "ls-input", name: "title", required: true, placeholder: "What do you need to do?" });
  const description = renderElement("textarea", { class: "ls-input", name: "description", rows: "3" });
  const day = renderElement("input", { class: "ls-input", name: "date", type: "date" });
  const link = renderElement("select", { class: "ls-input", name: "link" }, renderElement("option", { value: "", text: "No link" }));
  const group = (label: string, options: Array<[string, string]>): void => {
    if (options.length) link.append(renderElement("optgroup", { label }, ...options.map(([value, text]) => renderElement("option", { value, text }))));
  };
  group("Papers", papers.map((p) => [`paper:${p.id}`, p.title]));
  group("Projects", projects.map((p) => [`project:${p.projectId}`, p.title]));
  group("Spaces", ctx.view.spaces.map((s) => [`space:${s.id}`, s.name]));
  const error = renderElement("p", { class: "hm-dialog-error", role: "alert" });
  const form = renderElement("form", { class: "ls-dialog hm-dialog", role: "dialog", "aria-modal": "true", "aria-label": "New task" },
    renderElement("h2", { text: "New task" }),
    renderElement("label", {}, "Title", name), renderElement("label", {}, "Description", description),
    renderElement("label", {}, "Date (optional)", day), renderElement("label", {}, "Link (optional)", link), error);
  const close = mountFormDialog(form, { submitLabel: "Add task", signal: ctx.signal });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const [kind, ...rest] = link.value.split(":");
    const task = parseHomeTaskInput({ title: name.value, description: description.value, date: day.value, ...(link.value ? { link: { kind, ref: rest.join(":") } } : {}) });
    if (!task) { error.textContent = "Enter a title."; return; }
    post(ctx, { type: "home.addTask", task });
    close();
  });
  name.focus();
}

async function newTask(ctx: HomeContext): Promise<void> {
  const [papers, projects] = [await request(ctx, "listPapers", "papers"), await request(ctx, "listProjects", "projects")];
  if (!ctx.signal.aborted) openTaskDialog(ctx, papers.items, projects.items.filter((p) => p.available));
}

export function showAddMenu(ctx: HomeContext, anchor: HTMLElement): void {
  showMenu(anchor, [
    { label: "Paper…", icon: "book-open", onSelect: () => void pick(ctx, "paper") },
    { label: "Project…", icon: "file", onSelect: () => void pick(ctx, "project") },
    { label: "Space…", icon: "layers", onSelect: () => void pick(ctx, "space") },
    { label: "Note or topic…", icon: "file-text", hint: "Soon", onSelect: notYet },
    "separator",
    { label: "New task…", icon: "check-square", onSelect: () => void newTask(ctx) },
  ]);
}

export const isDeskFull = (ctx: HomeContext): boolean => ctx.view.desk.length >= ctx.view.deskLimit;

/** The strip with its cards, or the dashed invitation when the desk is empty, and the arrows over its edges that scroll it by a card. */
export function renderDeskStrip(ctx: HomeContext, add: (anchor: HTMLElement) => void): HTMLElement {
  if (!ctx.view.desk.length) {
    const empty = renderElement("button", { type: "button", class: "hm-empty-desk", disabled: readOnly(ctx) },
      renderElement("span", { "aria-hidden": "true", html: renderIcon("plus") }), "Pin something or add a task");
    empty.addEventListener("click", () => add(empty));
    return empty;
  }
  const strip = renderElement("div", { class: "hm-strip", role: "list" }, ...ctx.view.desk.map((c) => {
    const el = deskCard(ctx, c); el.setAttribute("role", "listitem"); return el;
  }));
  const scroll = (direction: number): void => {
    const first = strip.firstElementChild as HTMLElement | null;
    strip.scrollBy({ left: direction * ((first?.offsetWidth ?? 240) + 12), behavior: "smooth" });
  };
  const prev = iconButton("chevron-left", "Previous", () => scroll(-1), "ls-icon-btn hm-arrow hm-prev");
  const next = iconButton("chevron-right", "Next", () => scroll(1), "ls-icon-btn hm-arrow hm-next");
  const paint = (): void => {
    prev.hidden = strip.scrollLeft <= 1;
    next.hidden = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1;
  };
  strip.addEventListener("scroll", paint, { passive: true });
  requestAnimationFrame(paint);
  return renderElement("div", { class: "hm-strip-wrap" }, strip, prev, next);
}
