/**
 * Mounts the Details surface: paper or project details in one element, talking to its host over one Details channel, with
 * the tab strip, the paper and project slots and the tab state that decides what each shows.
 */
import { renderElement, renderIcon, moveTabFocus, type IconName, showToast } from "../../../ui/dom/index.js";
import type { DetailsToHost, HostToDetails, MessageEnd, HostToUi, LibraryTransport, UiToHost, DetailsSelection } from "../../protocol/index.js";
import { createPaneRequests, mountProjectPane } from "../../../writing/allProjects/dom/index.js";
import type { AllProjectsToHost, ProjectMenuCommand, ProjectRow } from "../../../writing/allProjects/index.js";
import type { LibraryUiCapabilities, LibraryUiLabels } from "../../index.js";
import { attachHostMessages } from "../hostMessages.js";
import { createUiCompositionRoot } from "../uiContext.js";
import { mountDetailPane } from "./detailPane.js";
import { LibraryViewStore, type PrefsPort } from "../../store/index.js";
import { closeTab, createInitialTabs, isPinnable, movePreviewToPinned, removeStaleTabs, applyDetailsSelection, setActiveTab, deriveShownSelection, type DetailsTabsState } from "../../detailsTabs.js";

/** One painted tab; `index` is the pinned tab's position, null for the preview. */
interface StripTab {
  index: number | null;
  label: string;
  icon: IconName;
  active: boolean;
  /** Only the preview of a pinnable target shows a pin button. */
  pinnable: boolean;
}

interface StripActions {
  select(index: number | null): void;
  pin(): void;
  close(index: number): void;
}

interface TabStrip {
  el: HTMLElement;
  render(tabs: readonly StripTab[]): void;
}

function tabButton(cls: string, glyph: IconName, label: string, title: string): HTMLButtonElement {
  return renderElement("button", { class: cls, type: "button", tabindex: -1, "aria-label": label, title, html: renderIcon(glyph) });
}

function paintTab(tab: StripTab, panel: HTMLElement): HTMLElement {
  const preview = tab.index === null;
  const tabEl = renderElement("div", {
    class: `ls-editor-tab${tab.active ? " active" : ""}${preview ? " preview" : ""}`,
    id: `${panel.id}-${preview ? "preview" : tab.index}`, "aria-controls": panel.id,
    role: "tab", "aria-selected": String(tab.active), tabindex: tab.active ? 0 : -1, title: tab.label,
  },
  renderElement("span", { class: "ls-editor-tab-icon", html: renderIcon(tab.icon) }),
  renderElement("span", { class: "ls-editor-tab-label", text: tab.label }));
  tabEl.dataset.tab = preview ? "preview" : String(tab.index);
  if (preview && tab.pinnable) tabEl.append(tabButton("ls-editor-tab-close ls-details-tab-pin", "pin", `Pin ${tab.label}`, "Pin"));
  if (!preview) tabEl.append(tabButton("ls-editor-tab-close", "x", `Close ${tab.label}`, "Close"));
  return tabEl;
}

const indexOf = (tabEl: HTMLElement): number | null => (tabEl.dataset.tab === "preview" ? null : Number(tabEl.dataset.tab));

/** Arrow, Home and End keys move focus between tabs; Enter and Space activate the focused one. */
function onKey(list: HTMLElement, e: KeyboardEvent, actions: StripActions): void {
  const tabEl = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
  if (!tabEl) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    actions.select(indexOf(tabEl));
    return;
  }
  moveTabFocus(list, tabEl, e);
}

function onClick(e: MouseEvent, actions: StripActions): void {
  const target = e.target as HTMLElement;
  const tabEl = target.closest<HTMLElement>('[role="tab"]');
  if (!tabEl) return;
  const index = indexOf(tabEl);
  if (target.closest(".ls-details-tab-pin")) actions.pin();
  else if (target.closest(".ls-editor-tab-close") && index !== null) actions.close(index);
  else actions.select(index);
}

/** `panel` is the tabpanel the tabs control; it needs an id. */
function mountTabStrip(panel: HTMLElement, actions: StripActions): TabStrip {
  const list = renderElement("div", { class: "ls-editor-tabs", role: "tablist", "aria-label": "Details tabs" });
  const bar = renderElement("div", { class: "ls-editor-titlebar ls-details-tabbar" }, list);
  list.addEventListener("click", (e) => onClick(e, actions));
  list.addEventListener("dblclick", (e) => {
    if ((e.target as HTMLElement).closest('[data-tab="preview"]')) actions.pin();
  });
  list.addEventListener("keydown", (e) => onKey(list, e, actions));
  return {
    el: bar,
    render(tabs) {
      const hadFocus = list.contains(document.activeElement);
      list.replaceChildren(...tabs.map((tab) => paintTab(tab, panel)));
      bar.hidden = tabs.length === 0;
      const active = list.querySelector<HTMLElement>(".ls-editor-tab.active");
      if (active) panel.setAttribute("aria-labelledby", active.id);
      else panel.removeAttribute("aria-labelledby");
      if (hadFocus) (active ?? list.querySelector<HTMLElement>('[role="tab"]'))?.focus();
      active?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    },
  };
}

interface ProjectSlot {
  /** Shows this project and asks the host for its detail; null shows none. */
  show(id: string | null): void;
  /** True while the shown project is among the host's rows. */
  hasContent(): boolean;
  /** Calls `listener` now and whenever `hasContent` may have changed. */
  watch(listener: () => void): void;
  /** The title of a project among the host's rows. */
  label(id: string): string | undefined;
  /** Calls `listener` with the ids of the host's rows whenever they arrive; returns the way to stop. */
  onItems(listener: (ids: ReadonlySet<string>) => void): () => void;
  dispose(): void;
}

function mountProjectSlot(el: HTMLElement, transport: MessageEnd<DetailsToHost, HostToDetails>): ProjectSlot {
  const post = (msg: AllProjectsToHost): void => transport.post({ channel: "projects", msg });
  const s = { id: null as string | null, rows: [] as ProjectRow[], commands: [] as ProjectMenuCommand[], openLabel: "Open" };
  const details = createPaneRequests(post);
  const pane = mountProjectPane(el, { post, menu: () => ({ rows: s.rows, commands: s.commands, post }) });
  let changed = (): void => undefined;
  const itemListeners = new Set<(ids: ReadonlySet<string>) => void>();
  const row = (): ProjectRow | undefined => s.rows.find((r) => r.id === s.id);
  const render = (): void => {
    const id = s.id;
    pane.update({ row: row(), detail: id ? details.get(id) : undefined, error: id ? details.error(id) : undefined, openLabel: s.openLabel });
    changed();
  };
  const offDetail = details.onChange((id) => { if (id === s.id) render(); });
  const offMessages = transport.subscribe((m) => {
    if (!("channel" in m) || m.channel !== "projects") return;
    const msg = m.msg;
    if (msg.type === "error") showToast(msg.message, "error");
    else if (msg.type === "detail") details.receive(msg);
    else if (msg.type === "projects") {
      Object.assign(s, { rows: msg.rows, commands: msg.commands, openLabel: msg.openLabel });
      render();
      if (s.id) details.request(s.id);
      const ids = new Set(s.rows.map((r) => r.id));
      itemListeners.forEach((listener) => listener(ids));
    }
  });
  return {
    show(id) { if (id && id !== s.id) details.request(id); s.id = id; render(); },
    hasContent: () => row() !== undefined,
    watch(listener) { changed = listener; listener(); },
    label: (id) => s.rows.find((r) => r.id === id)?.title,
    onItems(listener) { itemListeners.add(listener); return () => { itemListeners.delete(listener); }; },
    dispose: () => { offDetail(); offMessages(); },
  };
}

interface PaperSlotDeps {
  transport: MessageEnd<DetailsToHost, HostToDetails>;
  prefs: PrefsPort;
  caps: LibraryUiCapabilities;
  labels: LibraryUiLabels;
}

interface PaperSlot {
  /** Shows these papers; ids the library does not hold are ignored. */
  show(ids: readonly string[]): void;
  /** True while at least one paper is shown. */
  hasContent(): boolean;
  /** Calls `listener` now and whenever `hasContent` may have changed; returns the way to stop. */
  watch(listener: () => void): () => void;
  /** The title of a paper the library holds. */
  label(id: string): string | undefined;
  /** Calls `listener` with the ids the library holds once the first snapshot is in, then whenever its papers change. */
  onItems(listener: (ids: ReadonlySet<string>) => void): () => void;
  dispose(): void;
}

// The list owns the folder, the search, the selection it reports and the citation map; Details keeps the papers it was shown.
const LIST_ONLY = new Set<HostToUi["type"]>(["navigate", "searchTag", "reveal", "select", "citationMap.show", "citationMap.imported", "citationMap.importFailed"]);

/** Opening a folder belongs to the paper list, so Details asks the host to forward it there. */
class DetailsViewStore extends LibraryViewStore {
  private readonly post: (message: UiToHost) => void;
  constructor(post: (message: UiToHost) => void) { super(); this.post = post; }
  // INVARIANT: the host answers folder.open by showing the folder in the paper list, never as a library message.
  override openFolder(folder: string): void { this.post({ type: "folder.open", folder }); }
}

function libraryChannel(transport: PaperSlotDeps["transport"]): LibraryTransport {
  return {
    post: (msg) => transport.post({ channel: "library", msg }),
    subscribe: (handler) => transport.subscribe((m) => {
      if ("channel" in m && m.channel === "library" && !LIST_ONLY.has(m.msg.type)) handler(m.msg);
    }),
  };
}

/** `root` is the surface's root element; `el` is the slot the pane renders into. */
function mountPaperSlot(root: HTMLElement, el: HTMLElement, parts: PaperSlotDeps): PaperSlot {
  const transport = libraryChannel(parts.transport);
  const store = new DetailsViewStore(transport.post);
  const base = createUiCompositionRoot(root, { store, transport, prefs: parts.prefs, caps: parts.caps, labels: parts.labels, readOnly: false });
  // Keys belong to the list, which lives elsewhere.
  const ctx = { ...base, focusList: () => undefined };
  let wanted: readonly string[] = [];
  const held = (ids: readonly string[]): string[] => {
    const known = new Set(store.get().papers.map((p) => p.id));
    return ids.filter((id) => known.has(id));
  };
  // A target can arrive before the snapshot holding its papers, and a snapshot can drop a shown paper.
  const offPapers = store.select((s) => s.papers, () => {
    const selected = [...store.get().selected];
    const kept = held(selected);
    const next = kept.length > 0 ? kept : held(wanted);
    if (kept.length !== selected.length || (kept.length === 0 && next.length > 0)) store.set({ selected: new Set(next) });
  });
  const offs = [attachHostMessages(ctx), mountDetailPane(ctx, el), offPapers];
  return {
    show(ids) { wanted = ids; store.set({ selected: new Set(held(ids)) }); },
    hasContent: () => store.get().selected.size > 0,
    watch: (listener) => store.select((s) => s.selected.size > 0, () => listener()),
    label: (id) => store.get().papers.find((p) => p.id === id)?.title || undefined,
    onItems: (listener) => store.select((s) => (s.loading ? null : s.papers), (papers) => {
      if (papers) listener(new Set(papers.map((p) => p.id)));
    }),
    dispose: () => offs.forEach((off) => off()),
  };
}

interface DetailsTabsParts {
  /** The tabpanel the strip controls; the strip goes right before it. */
  panel: HTMLElement;
  prefs: PrefsPort;
  paper: PaperSlot;
  project: ProjectSlot;
  /** Shows the active tab's target in the slots. */
  show(target: DetailsSelection): void;
}

interface DetailsTabs {
  receive(target: DetailsSelection): void;
  dispose(): void;
}

function previewTab(target: Exclude<DetailsSelection, null>, parts: DetailsTabsParts, active: boolean): StripTab {
  const pinnable = isPinnable(target);
  if (target.kind === "project") return { index: null, label: parts.project.label(target.id) ?? "Project", icon: "folder", active, pinnable };
  const label = target.ids.length === 1 ? parts.paper.label(target.ids[0]!) ?? "Paper" : `${target.ids.length} papers`;
  return { index: null, label, icon: "file-text", active, pinnable };
}

function stripTabs(state: DetailsTabsState, parts: DetailsTabsParts): StripTab[] {
  const tabs: StripTab[] = state.pins.map((pin, index) => pin.kind === "project"
    ? { index, label: parts.project.label(pin.id) ?? "Project", icon: "folder", active: state.active === index, pinnable: false }
    : { index, label: parts.paper.label(pin.id) ?? "Paper", icon: "file-text", active: state.active === index, pinnable: false });
  if (state.preview) tabs.push(previewTab(state.preview, parts, state.active === null));
  return tabs;
}

function mountDetailsTabs(parts: DetailsTabsParts): DetailsTabs {
  let state = createInitialTabs(parts.prefs.load().detailsPins);
  const update = (next: DetailsTabsState): void => {
    const prev = state;
    state = next;
    if (next.pins !== prev.pins) parts.prefs.save({ detailsPins: [...next.pins] });
    const shown = deriveShownSelection(next);
    if (JSON.stringify(shown) !== JSON.stringify(deriveShownSelection(prev))) parts.show(shown);
    strip.render(stripTabs(state, parts));
  };
  const strip = mountTabStrip(parts.panel, {
    select: (index) => update(setActiveTab(state, index)),
    pin: () => update(movePreviewToPinned(state)),
    close: (index) => update(closeTab(state, index)),
  });
  parts.panel.before(strip.el);
  const offs = [
    parts.paper.onItems((ids) => update(removeStaleTabs(state, "paper", ids))),
    parts.project.onItems((ids) => update(removeStaleTabs(state, "project", ids))),
  ];
  strip.render(stripTabs(state, parts));
  return {
    receive: (target) => update(applyDetailsSelection(state, target)),
    dispose: () => { offs.forEach((off) => off()); strip.el.remove(); },
  };
}

export interface DetailsOptions {
  transport: MessageEnd<DetailsToHost, HostToDetails>;
  prefs: PrefsPort;
  /** What the host can do beyond the shared actions; see the library UI host contract. */
  capabilities: LibraryUiCapabilities;
  labels: LibraryUiLabels;
}

const EMPTY = `<div class="ls-empty-icon">${renderIcon("book")}</div><div>Select a paper or project to see its details.</div>`;

function slot(kind: string, label: string): HTMLElement {
  const el = document.createElement("aside");
  el.className = `detail-pane ls-details-${kind}`;
  el.setAttribute("aria-label", label);
  return el;
}

let mounted = 0;

/** Mounts the surface into `host`, says `ready` on both channels and returns the function that unmounts it. */
export function mountDetails(host: HTMLElement, options: DetailsOptions): () => void {
  const { transport } = options;
  const root = document.createElement("div");
  root.className = "ls-details";
  const paperEl = slot("paper", "Paper details");
  const projectEl = slot("project", "Project details");
  const empty = document.createElement("div");
  empty.className = "detail-placeholder ls-details-empty";
  empty.innerHTML = EMPTY;
  const body = document.createElement("div");
  body.className = "ls-details-body";
  body.id = `ls-details-${++mounted}`;
  body.setAttribute("role", "tabpanel");
  body.append(paperEl, projectEl, empty);
  root.append(body);
  host.append(root);
  let target: DetailsSelection = null;
  const paper = mountPaperSlot(root, paperEl, { transport, prefs: options.prefs, caps: options.capabilities, labels: options.labels });
  const project = mountProjectSlot(projectEl, transport);
  const refresh = (): void => {
    const paperShown = target?.kind === "paper" && paper.hasContent();
    const projectShown = target?.kind === "project" && project.hasContent();
    paperEl.hidden = !paperShown;
    projectEl.hidden = !projectShown;
    empty.hidden = paperShown || projectShown;
  };
  const offWatch = paper.watch(refresh);
  project.watch(refresh);
  const tabs = mountDetailsTabs({
    panel: body, prefs: options.prefs, paper, project,
    show(next) {
      target = next;
      paper.show(target?.kind === "paper" ? target.ids : []);
      project.show(target?.kind === "project" ? target.id : null);
      refresh();
    },
  });
  const offShow = transport.subscribe((m) => { if (!("channel" in m)) tabs.receive(m.target); });
  transport.post({ channel: "library", msg: { type: "ready" } });
  transport.post({ channel: "projects", msg: { type: "ready" } });
  return () => { offShow(); tabs.dispose(); offWatch(); paper.dispose(); project.dispose(); root.remove(); };
}
