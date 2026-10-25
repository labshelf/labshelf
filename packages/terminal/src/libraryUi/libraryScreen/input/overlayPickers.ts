/** Builds the fuzzy-filtered folder and paper pickers (z and Z). */
import { formatPaperLabel } from "../../preview.js";
import { createTextInput } from "../../createTextInput.js";
import type { PickerItem } from "../../overlays.js";
import { ALL } from "../screenModel.js";
import type { App } from "../app.js";

export function openFolderPicker(
  app: App, title: string, onPick: (rel: string) => void,
  options: { exclude?: (rel: string) => boolean; withAll?: boolean } = {},
): void {
  const nodes = [...app.ctx.store.snapshot.collections.values()].filter((node) => !options.exclude?.(node.rel));
  const items: PickerItem[] = nodes
    .map((node) => ({ id: node.rel, label: node.rel ? node.rel.split("/").join(" › ") : "Library root (unfiled)", detail: String(node.total) }))
    .sort((a, b) => (a.id === "" ? 1 : b.id === "" ? -1 : a.label.localeCompare(b.label)));
  if (options.withAll !== false) {
    items.unshift({ id: ALL, label: "All papers", detail: String(app.ctx.store.snapshot.papers.size) });
  }
  app.overlay = { kind: "picker", title, input: createTextInput(), items, filtered: items, index: 0, onPick: (item) => onPick(item.id) };
}

export function openPaperPicker(app: App): void {
  const items: PickerItem[] = [...app.ctx.store.snapshot.papers.values()].map((entry) => ({
    id: entry.record.id,
    label: formatPaperLabel(entry.record),
    detail: entry.collection || "unfiled",
  }));
  app.overlay = {
    kind: "picker", title: "Jump to paper", input: createTextInput(), items, filtered: items, index: 0,
    onPick: (item) => app.historyNav.revealPaper(item.id),
  };
}
