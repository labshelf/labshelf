// Runs the Details tabs: routes each target through the tab state, keeps the pins in the prefs and paints the strip.
import type { PrefsPort } from "../../store/index.js";
import {
  closeTab, createInitialTabs, isPinnable, movePreviewToPinned, removeStaleTabs, applyDetailsSelection, setActiveTab, deriveShownSelection,
  type DetailsTabsState, type DetailsSelection,
} from "../index.js";
import type { PaperSlot } from "./paperSlot.js";
import type { ProjectSlot } from "./projectSlot.js";
import { mountTabStrip, type StripTab } from "./tabStrip.js";

export interface DetailsTabsParts {
  /** The tabpanel the strip controls; the strip goes right before it. */
  panel: HTMLElement;
  prefs: PrefsPort;
  paper: PaperSlot;
  project: ProjectSlot;
  /** Shows the active tab's target in the slots. */
  show(target: DetailsSelection): void;
}

export interface DetailsTabs {
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

export function mountDetailsTabs(parts: DetailsTabsParts): DetailsTabs {
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
