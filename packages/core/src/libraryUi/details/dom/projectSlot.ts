// Shows the project the Details surface targets in the All projects detail pane, fed by the projects channel alone.
import type { MessageEnd } from "../../protocol/index.js";
import { showToast } from "../../../ui/dom/index.js";
import { createPaneRequests, mountProjectPane } from "../../../writing/allProjects/dom/projectDetailPane.js";
import type { AllProjectsToHost } from "../../../writing/allProjects/protocol.js";
import type { ProjectMenuCommand, ProjectRow } from "../../../writing/allProjects/index.js";
import type { DetailsToHost, HostToDetails } from "../protocol/index.js";

export interface ProjectSlot {
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

export function mountProjectSlot(el: HTMLElement, transport: MessageEnd<DetailsToHost, HostToDetails>): ProjectSlot {
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
