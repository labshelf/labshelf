// Fills the open paper's tray with its file rows and empties every other tray, rebuilding only when its inputs changed.
import type { PaperRecord } from "../../../../model/index.js";
import { openPaper } from "../../flows/index.js";
import type { UiContext } from "../../uiContext.js";
import { deriveTrayEntries, type TrayEntry, SHORT_NOTE_PLACEHOLDER } from "./fileFacts.js";
import { addRowActions } from "./trayActions.js";
import { buildFailedRow, buildLoadingRow, buildTrayRow } from "./trayRows.js";
import { renderElement } from "../../../../ui/dom/index.js";

const MAX_LENGTH = 140;
const PDF_NAME = "paper.pdf";

function noteButton(text: string, empty: boolean): HTMLButtonElement {
  const label = empty ? "Edit short note" : `Edit short note: ${text}`;
  return renderElement("button", { class: `file-fact-btn${empty ? " empty" : ""}`, type: "button", "aria-label": label, text });
}

function noteInput(value: string): HTMLInputElement {
  return renderElement("input", { class: "file-fact-input", type: "text", value, maxlength: String(MAX_LENGTH), spellcheck: "false", autocomplete: "off", "aria-label": "Short note" });
}

/** Fills the fact cell of the paper.pdf row with the short note and lets a click turn it into a text field; other rows are left alone. */
function addShortNote(ctx: UiContext, id: string, e: TrayEntry, row: HTMLElement): void {
  const cell = row.querySelector<HTMLElement>(".file-fact");
  if (e.kind !== "pdf" || !e.fact || !cell) return;
  let saved = e.fact.placeholder ? "" : e.fact.text;

  const show = (): HTMLButtonElement => {
    const button = noteButton(saved || SHORT_NOTE_PLACEHOLDER, !saved);
    // The row's own click would open the PDF.
    button.addEventListener("click", (ev) => { ev.stopPropagation(); edit(); });
    cell.replaceChildren(button);
    return button;
  };

  const edit = (): void => {
    const input = noteInput(saved);
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) return;
      done = true;
      const text = input.value.trim();
      if (commit && text !== saved) {
        saved = text;
        ctx.transport.post({ type: "paper.describeFile", id, name: PDF_NAME, description: text });
      }
      const hadFocus = document.activeElement === input;
      const button = show();
      if (hadFocus) button.focus({ preventScroll: true });
    };
    // Keys typed here belong to the field, not to the list shortcuts or the row.
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
    });
    input.addEventListener("click", (ev) => ev.stopPropagation());
    input.addEventListener("blur", () => finish(true));
    cell.replaceChildren(input);
    input.focus();
    input.select();
  };

  show();
}

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
  return deriveTrayEntries(record, state.files).map((e) => {
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

/** Replaces a tray's rows; focus inside it goes to the row of the same kind and name, or to the paper row when that row is gone. */
export function updateTrayRows(tray: HTMLElement, rows: HTMLElement[]): void {
  const hadFocus = tray.contains(document.activeElement);
  const key = rowKey(document.activeElement);
  tray.replaceChildren(...rows);
  if (!hadFocus) return;
  const target = rows.find((r) => rowKey(r) === key) ?? tray.closest(".paper-row")?.querySelector<HTMLElement>(".paper-row-main");
  target?.focus({ preventScroll: true });
}

/** Paints the tray of the expanded unit and clears the rest; call after the units are rendered and `.expanded` is set. */
export function drawTray(ctx: UiContext, root: HTMLElement, records: ReadonlyMap<string, PaperRecord>): void {
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
    updateTrayRows(tray, trayRows(ctx, id, record));
  });
}
