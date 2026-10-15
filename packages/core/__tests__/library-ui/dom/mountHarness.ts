/**
 * Mounts the library UI in jsdom against an in-test host that records every message the UI sends.
 */
import {
  DEFAULT_PREFS, createLoopbackTransport, type LibraryUiCapabilities, type LibraryUiPrefs, type PaperRecord, type PaperStats, type UiToHost,
} from "@labshelf/core";
import { mountLibraryUi } from "../../../src/library-ui/dom";

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

export function mountForTest(prefs: Partial<LibraryUiPrefs> = {}, capabilities: LibraryUiCapabilities = {}) {
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
    transport: ui, capabilities, labels: LABELS,
    prefs: { load: () => ({ ...DEFAULT_PREFS, ...prefs }), save: (p) => saved.push(p) },
  });
  disposePrevious = lib.dispose;
  const snapshot = (papers: PaperRecord[], pdfDirs: string[] = [], folders: Folders = [], stats: Record<string, PaperStats> = {}): void =>
    host.post({ type: "snapshot", snapshot: JSON.parse(JSON.stringify({ folders, papers, pdfDirs, stats })) });
  const rows = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>(".paper-row")];
  const rowIds = (): string[] => rows().map((r) => r.dataset["id"] ?? "");
  const key = (k: string, init: KeyboardEventInit = {}): void => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })); };
  const detail = (): HTMLElement => container.querySelector<HTMLElement>(".detail-pane")!;
  const click = (selector: string, root: ParentNode = container): void => { root.querySelector<HTMLElement>(selector)!.click(); };
  return { lib, host, sent, saved, container, snapshot, rows, rowIds, key, detail, click };
}

/** The labels of the open menu's items. */
export function menuLabels(): string[] {
  return [...document.querySelectorAll(".ls-menu-item .ls-menu-label")].map((e) => e.textContent ?? "");
}
