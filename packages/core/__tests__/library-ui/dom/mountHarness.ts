/**
 * Mounts the library UI in jsdom against an in-test host that records every message the UI sends.
 */
import { DEFAULT_PREFS, createLoopbackTransport, type LibraryUiPrefs, type PaperRecord, type UiToHost } from "@labshelf/core";
import { mountLibraryUi } from "../../../src/library-ui/dom";

export function paper(id: string, dir: string, extra: Partial<PaperRecord> = {}): PaperRecord {
  return { id, title: id, path: `${dir}/${id}`, citeKey: `key-${id}`, status: "unread", ...extra };
}

let disposePrevious: (() => void) | null = null;

export function mountForTest(prefs: Partial<LibraryUiPrefs> = {}) {
  disposePrevious?.();
  document.body.innerHTML = "";
  Element.prototype.scrollIntoView = () => undefined;
  const { ui, host } = createLoopbackTransport();
  const sent: UiToHost[] = [];
  host.subscribe((m) => sent.push(m));
  const saved: Array<Partial<LibraryUiPrefs>> = [];
  const container = document.createElement("div");
  document.body.append(container);
  const lib = mountLibraryUi(container, { transport: ui, prefs: { load: () => ({ ...DEFAULT_PREFS, ...prefs }), save: (p) => saved.push(p) } });
  disposePrevious = lib.dispose;
  const snapshot = (papers: PaperRecord[], pdfDirs: string[] = [], folders: Array<{ name: string; path: string; children: [] }> = []): void =>
    host.post({ type: "snapshot", snapshot: JSON.parse(JSON.stringify({ folders, papers, pdfDirs })) });
  const rows = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>(".paper-row")];
  const rowIds = (): string[] => rows().map((r) => r.dataset["id"] ?? "");
  const key = (k: string, init: KeyboardEventInit = {}): void => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...init })); };
  return { lib, host, sent, saved, container, snapshot, rows, rowIds, key };
}
