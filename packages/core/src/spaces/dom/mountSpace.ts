// Mounts a Space page with persistent inner-tab navigation over its host transport.
import { renderElement, renderEmptyNotice, mountPageTabs, renderIcon, renderMemberChip, setPlannedNotice } from "../../ui/dom/index.js";
import { SPACE_TABS, type SpacesTransport, type SpaceTab } from "../spacesProtocol.js";
import type { SpaceThreadEntry } from "../spaceDiscussionsStore.js";
import type { SpaceNoteEntry } from "../spaceNotesStore.js";
import { mountOverview, type SpaceBody, type SpaceSnapshot, type OverviewContext } from "./mountOverview.js";
import { mountSpacePapers } from "./mountSpacePapers.js";
import { mountSpaceGlossary } from "./mountSpaceGlossary.js";
import { mountSpaceNotes } from "./mountSpaceNotes.js";
import { mountSpaceDiscussions } from "./mountSpaceDiscussions.js";

function editable(value: string, label: string, className: string, disabled: boolean, save: (text: string) => void): HTMLInputElement {
  const input = renderElement("input", { class: className, value, title: value || label, "aria-label": label, placeholder: label, disabled });
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
  const share = renderElement("button", { class: "ls-btn ls-button-soft", type: "button" }, renderElement("span", { html: renderIcon("share") }), "Share");
  setPlannedNotice(share, "Sharing needs a signed-in account");
  return renderElement("header", { class: "sp-head" }, renderElement("div", { class: "sp-title" }, renderElement("h1", {}, title), description),
    renderElement("div", { class: "sp-people" }, renderMemberChip("You")), share);
}

const discoverReason = "Discover needs a connected discovery service";

function spaceDiscover(): HTMLElement {
  const filters = ["All", "Gaps", "For this project", "Later versions"].map((label, index) => {
    const button = renderPlannedButton(label, discoverReason, "dc-chip");
    button.setAttribute("aria-pressed", String(index === 0));
    return button;
  });
  return renderElement("div", { class: "dc-grid" },
    renderElement("div", { class: "dc-main" },
      renderElement("div", { class: "dc-search" }, renderPlannedSearch("Search this Space's feed", discoverReason)),
      renderElement("div", { class: "dc-chips", role: "group", "aria-label": "Discover filters" }, ...filters),
      renderElement("section", { class: "dc-feed", "aria-label": "Suggested papers" }, renderEmptyNotice({
        text: "No suggestions yet.", hint: "Discover will suggest papers from this Space's papers, citations and authors.",
      }))),
    renderElement("aside", { class: "dc-side", "aria-label": "Discovery services" },
      card("arXiv alerts", "No alerts for this Space.", "Alerts will follow categories and keywords for this Space.",
        "Set up alerts", "arXiv alerts need a connected alert service"),
      card("Watch", "No Watch results yet.", "Watch will check papers for later versions, retractions and errata.",
        "Check papers", "Watch needs connected paper lookup services")));
}

function card(title: string, text: string, hint: string, label: string, missing: string): HTMLElement {
  return renderElement("section", { class: "dc-card", "aria-label": title },
    renderElement("h2", { class: "dc-card-head", text: title }), renderEmptyNotice({ text, hint, inline: true }),
    renderPlannedButton(label, missing));
}

export function mountSpacePositioned(root: HTMLElement): () => void {
  root.replaceChildren(renderElement("div", { class: "sp-availability", role: "note" },
    renderElement("strong", { text: "Not available yet" }), renderElement("span", { text: "Discover needs a connected discovery service." })), spaceDiscover());
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
  const page = renderElement("div", { class: "sp" });
  const head = renderElement("div");
  const error = renderElement("div", { role: "alert" });
  const body = renderElement("div", { class: "sp-body", id: `ls-space-panel-${++nextPanel}`, tabindex: "0" });
  let tab = opts.tab ?? (opts.folder ? "papers" : "overview");
  let data: SpaceSnapshot | undefined;
  let mounted: SpaceBody | undefined;
  // The host posts these lists after `ready` and after a change, so a tab opened later reads the latest from here.
  const lists: SpaceLists = {};
  const scroll = new Map<SpaceTab, number>();
  const paint = (): void => {
    if (!data) { body.replaceChildren(renderEmptyNotice({ text: "Loading Space…" })); return; }
    if (data.readOnlyReason || !head.contains(document.activeElement)) {
      head.replaceChildren(spaceHeader({ data, end, readOnly: !!data.readOnlyReason }));
    }
    error.textContent = data.readOnlyReason ?? "";
    if (mounted) mounted.update(data);
    else mounted = mountBody(body, end, tab, data, lists, opts.folder);
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
    if (message.type === "spaceNotes" && message.spaceId === opts.id) lists.notes = message.notes;
    if (message.type === "spaceDiscussions" && message.spaceId === opts.id) lists.threads = message.threads;
    if (message.type === "error") error.textContent = `${message.action}: ${message.message}`;
  });
  paint(); end.post({ type: "ready", view: "space", id: opts.id });
  return () => { unsubscribe(); mounted?.dispose(); page.remove(); };
}
interface SpaceLists { notes?: SpaceNoteEntry[]; threads?: SpaceThreadEntry[] }
function mountBody(body: HTMLElement, end: SpacesTransport, tab: SpaceTab, data: SpaceSnapshot, lists: SpaceLists, folder?: string): SpaceBody {
  const context = { data, end, readOnly: !!data.readOnlyReason };
  if (tab === "overview") return mountOverview(body, context);
  if (tab === "papers") return mountSpacePapers(body, { ...context, ...(folder ? { folder } : {}) });
  if (tab === "glossary") return mountSpaceGlossary(body, context);
  if (tab === "notes") return mountSpaceNotes(body, { ...context, ...(lists.notes ? { notes: lists.notes } : {}) });
  if (tab === "discussions") return mountSpaceDiscussions(body, { ...context, ...(lists.threads ? { threads: lists.threads } : {}) });
  const dispose = mountSpacePositioned(body);
  return { update: () => {}, dispose };
}

function renderPlannedButton(label: string, reason: string, className = "ls-btn ls-btn-ghost"): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: className, text: label });
  setPlannedNotice(button, reason);
  return button;
}

function renderPlannedSearch(label: string, reason: string): HTMLInputElement {
  const input = renderElement("input", { type: "search", "aria-label": label, placeholder: label, readonly: true });
  setPlannedNotice(input, reason);
  return input;
}

