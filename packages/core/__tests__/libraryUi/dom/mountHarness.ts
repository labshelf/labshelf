/**
 * Mounts the library UI in jsdom against an in-test host that records every message the UI sends, with a detail pane
 * beside it that shares the list's store.
 */
import {
  DEFAULT_PREFS, createLoopbackTransport, type LibraryUiCapabilities, type LibraryUiPrefs, type PaperRecord, type PaperFilesState, type PaperStats, type UiToHost,
} from "@labshelf/core";
import type { ShareHost } from "../../../src/share/index";
import { createUiCompositionRoot, mountDetailPane, mountLibraryUi } from "../../../src/libraryUi/dom";

export function paper(id: string, dir: string, extra: Partial<PaperRecord> = {}): PaperRecord {
  return { id, title: id, path: `${dir}/${id}`, citeKey: `key-${id}`, status: "unread", ...extra };
}

/** Every capability a host can declare. */
export const ALL_CAPABILITIES: LibraryUiCapabilities = {
  textLayer: true, similar: true, reveal: true, openExternal: true,
  fetchMetadata: true,
};

export const LABELS = { addTooltip: "Add a paper", emptyHint: "Papers come in through the Add button.", revealPaper: "Reveal in Explorer" };

let disposePrevious: (() => void) | null = null;

type Folders = Array<{ name: string; path: string; children: [] }>;

export function mountForTest(prefs: Partial<LibraryUiPrefs> = {}, capabilities: LibraryUiCapabilities = {}, extra: { sharing?: ShareHost; readOnly?: boolean } = {}) {
  disposePrevious?.();
  document.body.innerHTML = "";
  Element.prototype.scrollIntoView = () => undefined;
  const { ui, host } = createLoopbackTransport();
  const sent: UiToHost[] = [];
  host.subscribe((m) => sent.push(m));
  const saved: Array<Partial<LibraryUiPrefs>> = [];
  const container = document.createElement("div");
  document.body.append(container);
  const lib = mountLibraryUi(container, {
    transport: ui, capabilities, labels: LABELS, ...extra,
    prefs: { load: () => ({ ...DEFAULT_PREFS, ...prefs }), save: (p) => saved.push(p) },
  });
  const detailEl = document.createElement("aside");
  detailEl.className = "detail-pane";
  container.append(detailEl);
  const prefsPort = { load: () => ({ ...DEFAULT_PREFS, ...prefs }), save: (p: Partial<LibraryUiPrefs>) => { saved.push(p); } };
  const detailCtx = createUiCompositionRoot(container, { store: lib.store, transport: ui, prefs: prefsPort, caps: capabilities, labels: LABELS, readOnly: false });
  const offDetail = mountDetailPane(detailCtx, detailEl);
  disposePrevious = () => { offDetail(); lib.dispose(); };
  const snapshot = (papers: PaperRecord[], pdfDirs: string[] = [], folders: Folders = [], stats: Record<string, PaperStats> = {}): void =>
    host.post({ type: "snapshot", snapshot: JSON.parse(JSON.stringify({ folders, papers, pdfDirs, stats })) });
  const rows = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>(".paper-row")];
  const rowIds = (): string[] => rows().map((r) => r.dataset["id"] ?? "");
  const key = (k: string, init: KeyboardEventInit = {}): void => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })); };
  const detail = (): HTMLElement => container.querySelector<HTMLElement>(".detail-pane")!;
  const click = (selector: string, root: ParentNode = container): void => { root.querySelector<HTMLElement>(selector)!.click(); };
  const files = (id: string, state: PaperFilesState): void => host.post({ type: "files", id, state });
  return { lib, host, sent, saved, container, snapshot, files, rows, rowIds, key, detail, click };
}

/** The labels of the open menu's items. */
export function menuLabels(): string[] {
  return [...document.querySelectorAll(".ls-menu-item .ls-menu-label")].map((e) => e.textContent ?? "");
}
