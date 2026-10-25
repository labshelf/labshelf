// Mounts the Details surface: paper or project details in one element, talking to its host over one Details channel.
import { icon } from "../../../ui/index.js";
import type { LibraryUiCapabilities, LibraryUiLabels } from "../../index.js";
import type { MessageEnd } from "../../protocol/index.js";
import type { PrefsPort } from "../../store/index.js";
import type { DetailsSelection, DetailsToHost, HostToDetails } from "../protocol/index.js";
import { mountPaperSlot } from "./paperSlot.js";
import { mountProjectSlot } from "./projectSlot.js";
import { mountDetailsTabs } from "./mountDetailsTabs.js";

export interface DetailsOptions {
  transport: MessageEnd<DetailsToHost, HostToDetails>;
  prefs: PrefsPort;
  /** What the host can do beyond the shared actions; see the library UI host contract. */
  capabilities: LibraryUiCapabilities;
  labels: LibraryUiLabels;
}

const EMPTY = `<div class="ls-empty-icon">${icon("book")}</div><div>Select a paper or project to see its details.</div>`;

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
