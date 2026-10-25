// Runs the Details tabs: routes each target through the tab state, keeps the pins in the prefs and paints the strip.
import type { PrefsPort } from "../../store/index.js";
import {
  closeTab, initialTabs, isPinnable, pinPreview, pruneTabs, receiveTarget, selectTab, shownTarget,
  type DetailsTabsState, type DetailsTarget,
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
  show(target: DetailsTarget): void;
}

export interface DetailsTabs {
  receive(target: DetailsTarget): void;
  dispose(): void;
}

function previewTab(target: Exclude<DetailsTarget, null>, parts: DetailsTabsParts, active: boolean): StripTab {
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
  let state = initialTabs(parts.prefs.load().detailsPins);
  const update = (next: DetailsTabsState): void => {
    const prev = state;
    state = next;
    if (next.pins !== prev.pins) parts.prefs.save({ detailsPins: [...next.pins] });
    const shown = shownTarget(next);
    if (JSON.stringify(shown) !== JSON.stringify(shownTarget(prev))) parts.show(shown);
    strip.render(stripTabs(state, parts));
  };
  const strip = mountTabStrip(parts.panel, {
    select: (index) => update(selectTab(state, index)),
    pin: () => update(pinPreview(state)),
    close: (index) => update(closeTab(state, index)),
  });
  parts.panel.before(strip.el);
  const offs = [
    parts.paper.onItems((ids) => update(pruneTabs(state, "paper", ids))),
    parts.project.onItems((ids) => update(pruneTabs(state, "project", ids))),
  ];
  strip.render(stripTabs(state, parts));
  return {
    receive: (target) => update(receiveTarget(state, target)),
    dispose: () => { offs.forEach((off) => off()); strip.el.remove(); },
  };
}
