// Fills the open paper's tray with its file rows and empties every other tray, rebuilding only when its inputs changed.
import type { PaperRecord } from "../../../../model/index.js";
import { openPaper } from "../../flows/index.js";
import type { UiContext } from "../../uiContext.js";
import { trayEntries, type TrayEntry } from "./fileFacts.js";
import { addShortNote } from "./shortNote.js";
import { addRowActions } from "./trayActions.js";
import { buildFailedRow, buildLoadingRow, buildTrayRow } from "./trayRows.js";

// What each tray was last built from, so an unrelated store change keeps its rows and focus.
const built = new WeakMap<HTMLElement, unknown[]>();

function activate(ctx: UiContext, id: string, e: TrayEntry): void {
  if (e.kind === "pdf") openPaper(ctx, id);
  else if (e.kind === "file") ctx.transport.post({ type: "paper.openFile", id, name: e.name });
  else if (e.kind === "folder") ctx.transport.post({ type: "paper.revealFile", id, name: e.name });
  // The Note row selects its paper; the detail pane then shows the note.
  else ctx.store.selectOnly(id);
}

function trayRows(ctx: UiContext, id: string, record: PaperRecord): HTMLElement[] {
  const state = ctx.store.get().files[id];
  if (!state || state.status === "loading") return [buildLoadingRow()];
  if (state.status === "failed") return [buildFailedRow(state.message)];
  return trayEntries(record, state.files).map((e) => {
    const open = (): void => activate(ctx, id, e);
    const row = buildTrayRow(e, open);
    addRowActions(ctx, id, e, row, open);
    addShortNote(ctx, id, e, row);
    return row;
  });
}

function rowKey(el: Element | null): string | null {
  const r = el?.closest(".file-row");
  const kind = r?.getAttribute("data-kind");
  return kind ? `${kind}:${r?.getAttribute("data-name")}` : null;
}

// Focus inside a replaced tray goes to the row with the same name, or to the paper row when that row is gone.
function replaceRows(tray: HTMLElement, rows: HTMLElement[]): void {
  const hadFocus = tray.contains(document.activeElement);
  const key = rowKey(document.activeElement);
  tray.replaceChildren(...rows);
  if (!hadFocus) return;
  const target = rows.find((r) => rowKey(r) === key) ?? tray.closest(".paper-row")?.querySelector<HTMLElement>(".paper-row-main");
  target?.focus({ preventScroll: true });
}

/** Paints the tray of the expanded unit and clears the rest; call after the units are rendered and `.expanded` is set. */
export function paintTray(ctx: UiContext, root: HTMLElement, records: ReadonlyMap<string, PaperRecord>): void {
  const { files } = ctx.store.get();
  root.querySelectorAll<HTMLElement>(".paper-row").forEach((unit) => {
    const tray = unit.querySelector<HTMLElement>(".paper-children");
    if (!tray) return;
    const id = unit.dataset["id"] ?? "";
    const record = records.get(id);
    if (!unit.classList.contains("expanded") || !record) {
      if (built.delete(tray)) tray.replaceChildren();
      return;
    }
    const inputs = [record, files[id]];
    const last = built.get(tray);
    if (last && inputs.every((v, i) => v === last[i])) return;
    built.set(tray, inputs);
    replaceRows(tray, trayRows(ctx, id, record));
  });
}
