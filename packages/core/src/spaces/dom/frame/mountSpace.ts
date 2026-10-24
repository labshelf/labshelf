// Mounts a Space page with persistent inner-tab navigation over its host transport.
import { el, emptyState, mountPageTabs } from "../../../ui/dom/index.js";
import { SPACE_TABS, type SpacesTransport, type SpaceTab } from "../../protocol/index.js";
import { mountOverview, type SpaceBody, type SpaceSnapshot } from "../spaceOverview/index.js";
import { mountSpacePapers } from "../papers/index.js";
import { mountSpaceGlossary } from "../glossary/index.js";
import { mountSpacePositioned } from "./mountSpacePositioned.js";
import { spaceHeader } from "./spaceHeader.js";
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
