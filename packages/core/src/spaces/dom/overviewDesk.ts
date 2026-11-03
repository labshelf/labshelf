// Renders the desk of the Space Overview: up to three pinned cards (papers, notes, topics, projects), empty slots, and the picker that pins one.
import { renderElement, renderIcon, renderMemberChip, pickQuickEntry, type IconName, type QuickPickEntry } from "../../ui/dom/index.js";
import { mountQmdEditor, type QmdEditorHandle } from "../../qmd/dom/index.js";
import { renderReadingStatusMark } from "../../ui/icons/index.js";
import { formatDay, formatRelativeTime } from "../../time/index.js";
import { SPACE_DESK_LIMIT, type SpaceDeskKind } from "../space.js";
import type { DeskCard, ResolvedPaper, PapersTreeFolder } from "../spaceViews.js";
import type { OverviewContext } from "./mountOverview.js";
import { isDeskFull, isOnDesk } from "./deskToggle.js";

const KIND_LABEL: Record<SpaceDeskKind, string> = { paper: "Paper", note: "Note", thread: "Discussion", project: "Project" };
const KIND_GLYPH: Record<SpaceDeskKind, IconName> = { paper: "book-open", note: "file-text", thread: "message", project: "file" };
const STATUS_LABEL = { done: "Done", reading: "Reading", unread: "Unread" } as const;

/** Mounts read-only qmd previews; `destroy` releases them before the desk repaints. */
export interface DeskPreviews {
  mount(host: HTMLElement, body: string): void;
  destroy(): void;
}

export function createDeskPreviews(): DeskPreviews {
  let editors: QmdEditorHandle[] = [];
  return {
    mount(host, body) { editors.push(mountQmdEditor(host, { body, readOnly: true, onChange: () => {} })); },
    destroy() { for (const editor of editors) editor.destroy(); editors = []; },
  };
}

function button(label: string, onClick: () => void, opts: { glyph?: IconName; className?: string; disabled?: boolean; ariaLabel?: string } = {}): HTMLButtonElement {
  const el = renderElement("button", { type: "button", class: opts.className ?? "ls-btn ls-btn-ghost", text: label, disabled: opts.disabled ?? false });
  if (opts.ariaLabel) el.setAttribute("aria-label", opts.ariaLabel);
  if (opts.glyph) el.prepend(renderElement("span", { "aria-hidden": "true", html: renderIcon(opts.glyph) }));
  el.addEventListener("click", onClick);
  return el;
}

const glyph = (html: string): HTMLElement => renderElement("span", { class: "ov-glyph", "aria-hidden": "true", html });
const arrow = (): HTMLElement => renderElement("span", { class: "ov-arrow", "aria-hidden": "true", html: renderIcon("arrow-right") });

function unpin(ctx: OverviewContext, card: DeskCard, title: string): HTMLButtonElement {
  const el = button("", () => ctx.end.post({ type: "unpinFromDesk", id: ctx.data.space.id, kind: card.kind, ref: card.ref }),
    { glyph: "pin", className: "ls-btn ls-btn-ghost ov-unpin", disabled: ctx.readOnly, ariaLabel: `Unpin ${title}` });
  el.title = "Unpin from desk";
  return el;
}

let nextId = 0;
/** A card whose title button covers the whole card, so the card opens on a click anywhere outside its other buttons. */
function card(kind: SpaceDeskKind, preview: HTMLElement, foot: { icon: string; title: string; sub: string; subClass?: string; open?: () => void }, extra: HTMLElement[]): HTMLElement {
  const subId = `ov-desk-sub-${++nextId}`;
  const name = foot.open
    ? button(foot.title, foot.open, { className: "ov-open ov-name" })
    : renderElement("span", { class: "ov-name", text: foot.title });
  name.title = foot.title;
  if (foot.open) name.setAttribute("aria-describedby", subId);
  return renderElement("article", { class: `ov-card ov-card-${kind}${foot.open ? "" : " missing"}` }, preview,
    renderElement("div", { class: "ov-foot" }, glyph(foot.icon),
      renderElement("div", { class: "ov-main" }, name, renderElement("span", { id: subId, class: `ov-sub ${foot.subClass ?? ""}`.trim(), text: foot.sub })),
      ...extra, ...(foot.open ? [arrow()] : [])));
}

function paperCard(ctx: OverviewContext, c: Extract<DeskCard, { kind: "paper" }>): HTMLElement {
  const paper = c.paper;
  if (paper.missing) {
    return card("paper", renderElement("div", { class: "ov-page" }, renderElement("span", { class: "ov-page-note", text: `${paper.id} — Not in your Library` })),
      { icon: renderIcon("file-minus"), title: paper.id, sub: "Not in your Library" }, [unpin(ctx, c, paper.id)]);
  }
  const byline = [...paper.authors, paper.year].filter(Boolean).join(" · ");
  const el = card("paper", renderElement("div", { class: "ov-page", "aria-hidden": "true" }, renderElement("span", { class: "ov-page-title", text: paper.title }),
    byline ? renderElement("span", { class: "ov-page-byline", text: byline }) : ""),
  { icon: renderReadingStatusMark(paper.status), title: paper.title, sub: `Paper · ${STATUS_LABEL[paper.status]}`, subClass: `ov-status ${paper.status}`,
    open: () => ctx.end.post({ type: "openPaper", paperId: paper.id }) }, [unpin(ctx, c, paper.title)]);
  el.querySelector(".ov-open")?.addEventListener("focus", () => ctx.end.post({ type: "selectPaper", paperId: paper.id }));
  return el;
}

function missingCard(ctx: OverviewContext, c: DeskCard): HTMLElement {
  const what = c.kind === "note" ? "note" : "topic";
  return card(c.kind, renderElement("div", { class: "ov-page" }, renderElement("span", { class: "ov-page-note", text: `This ${what} is no longer in the Space.` })),
    { icon: renderIcon("file-minus"), title: c.ref, sub: `${KIND_LABEL[c.kind]} · Not found` }, [unpin(ctx, c, c.ref)]);
}

function noteCard(ctx: OverviewContext, c: Extract<DeskCard, { kind: "note"; missing: false }>, previews: DeskPreviews): HTMLElement {
  const body = renderElement("div", { class: "ov-page ov-note-body", "aria-hidden": "true" });
  previews.mount(body, c.body);
  const edited = formatRelativeTime(c.updated);
  return card("note", body, { icon: renderIcon("file-text"), title: c.title, sub: edited ? `Note · Edited ${edited}` : "Note",
    open: () => ctx.openItem?.("notes", c.ref) }, [unpin(ctx, c, c.title)]);
}

function threadCard(ctx: OverviewContext, c: Extract<DeskCard, { kind: "thread"; missing: false }>, previews: DeskPreviews): HTMLElement {
  const open = (): void => ctx.openItem?.("discussions", c.ref);
  const topic = renderElement("div", { class: "ov-thread-text" });
  if (c.topic) previews.mount(topic, c.topic);
  const parts: HTMLElement[] = [
    renderElement("div", { class: "ov-thread-kind" }, renderElement("span", { "aria-hidden": "true", html: renderIcon("message") }), "Discussion",
      renderElement("span", { class: `ov-thread-dot ${c.status}`, role: "img", "aria-label": c.status === "open" ? "Open" : "Resolved" })),
    renderElement("h3", { class: "ov-thread-title" }, button(c.title, open, { className: "ov-open" })), topic,
  ];
  if (c.last) {
    const reply = renderElement("div", { class: "ov-thread-text" });
    previews.mount(reply, c.last.body);
    const author = c.last.author ?? "Someone";
    parts.push(renderElement("div", { class: "ov-reply" }, renderMemberChip(author),
      renderElement("div", { class: "ov-main" }, renderElement("span", { class: "ov-reply-head" }, renderElement("strong", { text: author }),
        renderElement("span", { class: "ov-sub", text: formatRelativeTime(c.last.created) })), reply)));
  }
  const replies = `${c.replies} ${c.replies === 1 ? "reply" : "replies"} · ${c.status === "open" ? "Open" : "Resolved"}`;
  return renderElement("article", { class: "ov-card ov-card-thread" }, renderElement("div", { class: "ov-thread" }, ...parts),
    renderElement("div", { class: "ov-foot" }, renderElement("span", { class: "ov-main ov-sub", text: replies }),
      unpin(ctx, c, c.title), button("Reply", open, { glyph: "arrow-right", className: "ls-btn ov-reply-btn", ariaLabel: `Reply to ${c.title}` })));
}

function projectCard(ctx: OverviewContext, c: Extract<DeskCard, { kind: "project" }>): HTMLElement {
  const p = c.project;
  const meta = p.available ? [p.format, p.mainFile].filter(Boolean).join(" · ") : "Not on this device";
  const preview = renderElement("div", { class: "ov-page ov-project-page", "aria-hidden": "true" },
    renderElement("span", { class: "ov-page-title", text: p.title }), meta ? renderElement("span", { class: "ov-page-byline", text: meta }) : "",
    p.checklist ? renderElement("span", { class: "ov-page-line", text: `${p.checklist.done} / ${p.checklist.total} Done` }) : "",
    p.deadline ? renderElement("span", { class: "ov-page-line", text: `Due ${formatDay(p.deadline)}` }) : "");
  return card("project", preview, { icon: renderIcon("file"), title: p.title, sub: `Project${p.deadline ? ` · Due ${formatDay(p.deadline)}` : ""}`,
    ...(p.available ? { open: () => ctx.end.post({ type: "openProject", projectId: p.projectId }) } : {}) }, [unpin(ctx, c, p.title)]);
}

function deskCard(ctx: OverviewContext, c: DeskCard, previews: DeskPreviews): HTMLElement {
  if (c.kind === "paper") return paperCard(ctx, c);
  if (c.kind === "project") return projectCard(ctx, c);
  if (c.missing) return missingCard(ctx, c);
  return c.kind === "note" ? noteCard(ctx, c, previews) : threadCard(ctx, c, previews);
}

export function renderDesk(ctx: OverviewContext, previews: DeskPreviews): HTMLElement {
  const desk = renderElement("div", { class: "ov-desk" }, ...ctx.data.overview.desk.map(c => deskCard(ctx, c, previews)));
  for (let slot = ctx.data.overview.desk.length; slot < SPACE_DESK_LIMIT; slot++) {
    desk.append(button(slot === ctx.data.overview.desk.length ? "Pin what matters now" : "", () => void pinToDesk(ctx),
      { className: "ov-slot", disabled: ctx.readOnly, ariaLabel: "Pin to desk", glyph: "plus" }));
  }
  return desk;
}

function flattenPapers(folders: readonly PapersTreeFolder[], papers: readonly ResolvedPaper[]): ResolvedPaper[] {
  return [...papers, ...folders.flatMap(folder => flattenPapers(folder.folders, folder.papers))];
}

type Pick = { kind: SpaceDeskKind; ref: string };
/** The papers, notes, topics and projects of the Space that are not on the desk yet, grouped by kind. */
function deskCandidates(ctx: OverviewContext): QuickPickEntry<Pick>[] {
  const lists = ctx.lists?.() ?? {};
  const groups: Array<[SpaceDeskKind, Array<{ label: string; ref: string; description?: string }>]> = [
    ["paper", flattenPapers(ctx.data.papers.folders, ctx.data.papers.papers).flatMap(p => p.missing ? [] : [{ label: p.title, ref: p.id, description: p.authors.join(", ") }])],
    ["note", (lists.notes ?? []).map(n => ({ label: n.title, ref: n.path }))],
    ["thread", (lists.threads ?? []).map(t => ({ label: t.title, ref: t.path, description: t.status === "open" ? "Open" : "Resolved" }))],
    ["project", ctx.data.projects.filter(p => p.available).map(p => ({ label: p.title, ref: p.projectId, ...(p.format ? { description: p.format } : {}) }))],
  ];
  return groups.flatMap(([kind, items]) => {
    const free = items.filter(item => !isOnDesk(ctx, kind, item.ref));
    if (!free.length) return [];
    return [{ kind: "separator" as const, label: `${KIND_LABEL[kind]}s` },
      ...free.map(item => ({ label: item.label, icon: KIND_GLYPH[kind], value: { kind, ref: item.ref }, ...(item.description ? { description: item.description } : {}) }))];
  });
}

export async function pinToDesk(ctx: OverviewContext): Promise<void> {
  if (ctx.readOnly || isDeskFull(ctx)) return;
  const signal = ctx.signal;
  const picked = await pickQuickEntry(deskCandidates(ctx), { title: "Pin to desk", placeholder: "Papers, notes, discussions and projects", ...(signal ? { signal } : {}) });
  if (picked && !signal?.aborted && !ctx.readOnly) ctx.end.post({ type: "pinToDesk", id: ctx.data.space.id, kind: picked.kind, ref: picked.ref });
}
