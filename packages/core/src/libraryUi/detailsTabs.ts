// Decides what the Details surface shows: each source keeps its last selection, and its tabs hold one preview and the items the user pinned.
import type { PinnedItem } from "./store/index.js";
import type { DetailsSelection } from "./protocol/index.js";

/** `active` indexes `pins`; null is the preview. */
export interface DetailsTabsState {
  readonly pins: readonly PinnedItem[];
  readonly preview: DetailsSelection;
  readonly active: number | null;
}

export function createInitialTabs(pins: readonly PinnedItem[]): DetailsTabsState {
  return { pins, preview: null, active: null };
}

/** Only one paper or one project can have its own tab. */
export function isPinnable(target: DetailsSelection): boolean {
  return target !== null && (target.kind === "project" || target.ids.length === 1);
}

function asPin(target: DetailsSelection): PinnedItem | null {
  if (!target || !isPinnable(target)) return null;
  return target.kind === "project" ? { kind: "project", id: target.id } : { kind: "paper", id: target.ids[0]! };
}

function asTarget(pin: PinnedItem): DetailsSelection {
  return pin.kind === "project" ? { kind: "project", id: pin.id } : { kind: "paper", ids: [pin.id] };
}

function pinIndex(state: DetailsTabsState, target: DetailsSelection): number {
  const pin = asPin(target);
  return pin ? state.pins.findIndex((p) => p.kind === pin.kind && p.id === pin.id) : -1;
}

/** A pinned target activates its tab; any other replaces the preview; null clears the preview. */
export function applyDetailsSelection(state: DetailsTabsState, target: DetailsSelection): DetailsTabsState {
  if (target === null) return { ...state, preview: null };
  const index = pinIndex(state, target);
  return index >= 0 ? { ...state, active: index } : { ...state, preview: target, active: null };
}

/** Moves the preview into a pinned tab, which becomes active, and empties the preview until the next target. */
export function movePreviewToPinned(state: DetailsTabsState): DetailsTabsState {
  const pin = asPin(state.preview);
  if (!pin) return state;
  const index = pinIndex(state, state.preview);
  if (index >= 0) return { ...state, preview: null, active: index };
  return { pins: [...state.pins, pin], preview: null, active: state.pins.length };
}

export function setActiveTab(state: DetailsTabsState, active: number | null): DetailsTabsState {
  return { ...state, active };
}

/** Closing the active tab moves to the next pinned tab, else the previous one, else the preview. */
export function closeTab(state: DetailsTabsState, index: number): DetailsTabsState {
  const pins = state.pins.filter((_, i) => i !== index);
  const { active } = state;
  if (active === null || active < index) return { ...state, pins };
  if (active > index) return { ...state, pins, active: active - 1 };
  return { ...state, pins, active: pins.length === 0 ? null : Math.min(index, pins.length - 1) };
}

/** Drops the pins of `kind` whose ids are not in `existing`; an active dropped tab falls back to the preview. */
export function removeStaleTabs(state: DetailsTabsState, kind: PinnedItem["kind"], existing: ReadonlySet<string>): DetailsTabsState {
  const keep = (p: PinnedItem): boolean => p.kind !== kind || existing.has(p.id);
  if (state.pins.every(keep)) return state;
  const activePin = state.active === null ? null : state.pins[state.active]!;
  const pins = state.pins.filter(keep);
  const active = activePin && keep(activePin) ? pins.indexOf(activePin) : null;
  return { ...state, pins, active };
}

/** The target the active tab shows. */
export function deriveShownSelection(state: DetailsTabsState): DetailsSelection {
  return state.active === null ? state.preview : asTarget(state.pins[state.active]!);
}

export interface SelectionHub {
  /** Stores the source's target and shows it. */
  publish(source: string, target: DetailsSelection): void;
  /** Shows the source's stored target; does nothing when the source has published none. */
  activate(source: string): void;
  /** The last target shown, so a Details surface mounted late can catch up. */
  current(): DetailsSelection;
}

/** `show` receives every target the hub decides to show. Sources are names the app chooses. */
export function createSelectionHub(show: (target: DetailsSelection) => void): SelectionHub {
  const bySource = new Map<string, DetailsSelection>();
  let shown: DetailsSelection = null;
  const display = (target: DetailsSelection): void => { shown = target; show(target); };
  return {
    publish(source, target) { bySource.set(source, target); display(target); },
    activate(source) { if (bySource.has(source)) display(bySource.get(source)!); },
    current: () => shown,
  };
}
