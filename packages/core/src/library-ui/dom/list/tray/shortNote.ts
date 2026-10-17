// Edits the short personal note on the paper.pdf row in place and saves it as the description of paper.pdf.
import { el } from "../../../../ui/dom/index.js";
import type { UiContext } from "../../uiContext.js";
import { SHORT_NOTE_PLACEHOLDER, type TrayEntry } from "./fileFacts.js";

const MAX_LENGTH = 140;
const PDF_NAME = "paper.pdf";

function noteButton(text: string, empty: boolean): HTMLButtonElement {
  const label = empty ? "Edit short note" : `Edit short note: ${text}`;
  return el("button", { class: `file-fact-btn${empty ? " empty" : ""}`, type: "button", "aria-label": label, text });
}

function noteInput(value: string): HTMLInputElement {
  return el("input", { class: "file-fact-input", type: "text", value, maxlength: String(MAX_LENGTH), spellcheck: "false", autocomplete: "off", "aria-label": "Short note" });
}

/** Fills the fact cell of the paper.pdf row with the short note and lets a click turn it into a text field; other rows are left alone. */
export function addShortNote(ctx: UiContext, id: string, e: TrayEntry, row: HTMLElement): void {
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
