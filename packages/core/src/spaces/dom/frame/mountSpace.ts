// Mounts a Space page with persistent inner-tab navigation over its host transport.
import { el, emptyState, mountPageTabs, icon, memberChip, positioned } from "../../../ui/dom/index.js";
import { SPACE_TABS, type SpacesTransport, type SpaceTab } from "../../protocol/index.js";
import { mountOverview, type SpaceBody, type SpaceSnapshot, type OverviewContext } from "../spaceOverview/index.js";
import { mountSpacePapers } from "../papers/index.js";
import { mountSpaceGlossary } from "../glossary/index.js";
import { spaceDiscussions } from "./discussions.js";
import { plannedButton, plannedSearch } from "./controls.js";

function editable(value: string, label: string, className: string, disabled: boolean, save: (text: string) => void): HTMLInputElement {
  const input = el("input", { class: className, value, title: value || label, "aria-label": label, placeholder: label, disabled });
  const commit = (): void => { if (input.value !== value) save(input.value); };
  input.addEventListener("change", commit);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); input.blur(); }
    if (event.key === "Escape") { input.value = value; input.blur(); }
  });
  return input;
}
function spaceHeader(ctx: OverviewContext): HTMLElement {
  const { id, name, purpose } = ctx.data.space;
  const title = editable(name, "Space name", "sp-name", ctx.readOnly, text => {
    if (text.trim()) ctx.end.post({ type: "renameSpace", id, name: text.trim() });
  });
  const description = editable(purpose ?? "", "Add a purpose", "sp-purpose", ctx.readOnly,
    text => ctx.end.post({ type: "setPurpose", id, ...(text.trim() ? { purpose: text.trim() } : {}) }));
  const share = el("button", { class: "ls-btn ls-button-soft", type: "button" }, el("span", { html: icon("share") }), "Share");
  positioned(share, "Sharing needs a signed-in account");
  return el("header", { class: "sp-head" }, el("div", { class: "sp-title" }, el("h1", {}, title), description),
    el("div", { class: "sp-people" }, memberChip("You")), share);
}

function spaceNotes(): HTMLElement {
  return el("div", { class: "nt-notes" },
    el("div", { class: "nt-bar" },
      el("p", { text: "Keep ideas, comparisons and quotes alongside this Space's papers." }),
      plannedButton("New note", "Notes need a connected note editor", "ls-btn ls-btn-ghost")),
    group("Space notes", "No Space notes yet.", "Space notes will keep meeting notes and ideas together."),
    group("Paper notes", "No Paper notes yet.", "Paper notes will keep your notes beside their paper."));
}

function group(title: string, text: string, hint: string): HTMLElement {
  return el("section", { class: "nt-group", "aria-label": title },
    el("h2", { text: title }), emptyState({ text, hint, inline: true }));
}

const reason = "Discover needs a connected discovery service";

function spaceDiscover(): HTMLElement {
  const filters = ["All", "Gaps", "For this project", "Later versions"].map((label, index) => {
    const button = plannedButton(label, reason, "dc-chip");
    button.setAttribute("aria-pressed", String(index === 0));
    return button;
  });
  return el("div", { class: "dc-grid" },
    el("div", { class: "dc-main" },
      el("div", { class: "dc-search" }, plannedSearch("Search this Space's feed", reason)),
      el("div", { class: "dc-chips", role: "group", "aria-label": "Discover filters" }, ...filters),
      el("section", { class: "dc-feed", "aria-label": "Suggested papers" }, emptyState({
        text: "No suggestions yet.", hint: "Discover will suggest papers from this Space's papers, citations and authors.",
      }))),
    el("aside", { class: "dc-side", "aria-label": "Discovery services" },
      card("arXiv alerts", "No alerts for this Space.", "Alerts will follow categories and keywords for this Space.",
        "Set up alerts", "arXiv alerts need a connected alert service"),
      card("Watch", "No Watch results yet.", "Watch will check papers for later versions, retractions and errata.",
        "Check papers", "Watch needs connected paper lookup services")));
}

function card(title: string, text: string, hint: string, label: string, missing: string): HTMLElement {
  return el("section", { class: "dc-card", "aria-label": title },
    el("h2", { class: "dc-card-head", text: title }), emptyState({ text, hint, inline: true }),
    plannedButton(label, missing));
}

export function mountSpacePositioned(root: HTMLElement, tab: "notes" | "discussions" | "discover"): () => void {
  const build = { notes: spaceNotes, discussions: spaceDiscussions, discover: spaceDiscover };
  const reasons = { notes: "Notes need a connected note editor.", discussions: "Discussions need collaboration.", discover: "Discover needs a connected discovery service." };
  root.replaceChildren(el("div", { class: "sp-availability", role: "note" },
    el("strong", { text: "Not available yet" }), el("span", { text: reasons[tab] })), build[tab]());
  return () => root.replaceChildren();
}

export interface MountSpaceOptions {
  id: string;
  tab?: SpaceTab;
  folder?: string;
  onTab?: (tab: SpaceTab) => void;
}
let nextPanel = 0;
export function mountSpace(root: HTMLElement, end: SpacesTransport, opts: MountSpaceOptions): () => void {
  const page = el("div", { class: "sp" });
  const head = el("div");
  const error = el("div", { role: "alert" });
  const body = el("div", { class: "sp-body", id: `ls-space-panel-${++nextPanel}`, tabindex: "0" });
  let tab = opts.tab ?? (opts.folder ? "papers" : "overview");
  let data: SpaceSnapshot | undefined;
  let mounted: SpaceBody | undefined;
  const scroll = new Map<SpaceTab, number>();
  const paint = (): void => {
    if (!data) { body.replaceChildren(emptyState({ text: "Loading Space…" })); return; }
    if (data.readOnlyReason || !head.contains(document.activeElement)) {
      head.replaceChildren(spaceHeader({ data, end, readOnly: !!data.readOnlyReason }));
    }
    error.textContent = data.readOnlyReason ?? "";
    if (mounted) mounted.update(data);
    else mounted = mountBody(body, end, tab, data, opts.folder);
  };
  const tabs = mountPageTabs(body, { label: "Space views", selected: tab,
    tabs: SPACE_TABS.map(id => ({ id, label: id[0]!.toUpperCase() + id.slice(1) })),
    onSelect: id => {
      if (id === tab) return;
      scroll.set(tab, page.scrollTop);
      mounted?.dispose(); mounted = undefined; tab = id as SpaceTab; paint();
      page.scrollTop = scroll.get(tab) ?? 0;
      opts.onTab?.(tab);
    } });
  page.append(head, tabs.el, error, body); root.replaceChildren(page);
  const unsubscribe = end.subscribe(message => {
    if (message.type === "space" && message.space.id === opts.id) { data = message; paint(); }
    if (message.type === "error") error.textContent = `${message.action}: ${message.message}`;
  });
  paint(); end.post({ type: "ready", view: "space", id: opts.id });
  return () => { unsubscribe(); mounted?.dispose(); page.remove(); };
}
function mountBody(body: HTMLElement, end: SpacesTransport, tab: SpaceTab, data: SpaceSnapshot, folder?: string): SpaceBody {
  const context = { data, end, readOnly: !!data.readOnlyReason };
  if (tab === "overview") return mountOverview(body, context);
  if (tab === "papers") return mountSpacePapers(body, { ...context, ...(folder ? { folder } : {}) });
  if (tab === "glossary") return mountSpaceGlossary(body, context);
  const dispose = mountSpacePositioned(body, tab);
  return { update: () => {}, dispose };
}
