// The Consult chooser (plan local-sync, consult-window D2): a modal picker over a ConsultClient with Paper, Notes, Manuscript and Code lists,
// and Browse… for code where the host can show a file dialog. Picking an entry hands it to the caller and closes the chooser.
import { mountCombobox, renderElement, renderPickerDialog, renderTextButton, type ComboboxSuggestion } from "../../../ui/dom/index.js";
import type { ConsultEntry, ConsultKind } from "../consultRequests.js";
import { askConsult, type ConsultClient } from "./consultClient.js";

export interface ConsultChooserOptions {
  client: ConsultClient;
  /** The kind last chosen, kept by the caller; the chooser starts on it and writes it on each switch. */
  memory?: { kind?: ConsultKind };
  onPick(entry: ConsultEntry): void;
  onError?(error: unknown): void;
  /** Adds a Link output… button, for a surface that links outputs; it closes the chooser first. */
  onLinkOutput?(): void;
}

const KINDS: ReadonlyArray<{ kind: ConsultKind; label: string }> = [
  { kind: "paper", label: "Paper" },
  { kind: "notes", label: "Notes" },
  { kind: "manuscript", label: "Manuscript" },
  { kind: "code", label: "Code" },
];

/** The entries with those of one group together, groups in the order they first appear; the group shows before the entry's own detail. */
function toSuggestions(entries: readonly ConsultEntry[]): { suggestions: ComboboxSuggestion[]; byValue: Map<string, ConsultEntry> } {
  const groups: string[] = [];
  for (const entry of entries) { if (entry.group !== undefined && !groups.includes(entry.group)) { groups.push(entry.group); } }
  const ordered = [...groups.flatMap((group) => entries.filter((entry) => entry.group === group)), ...entries.filter((entry) => entry.group === undefined)];
  const byValue = new Map<string, ConsultEntry>();
  const suggestions = ordered.map((entry, index): ComboboxSuggestion => {
    const value = `${index}`;
    byValue.set(value, entry);
    const detail = [entry.group, entry.detail].filter((part): part is string => part !== undefined && part !== "").join(" · ");
    return { label: entry.label, value, ...(detail ? { detail } : {}) };
  });
  return { suggestions, byValue };
}

function errorSentence(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Could not reach the library.";
}

class ConsultChooser {
  private kind: ConsultKind;
  private seq = 0;
  private done = false;
  private byValue = new Map<string, ConsultEntry>();
  private readonly buttons = new Map<ConsultKind, HTMLButtonElement>();
  private readonly picker = mountCombobox({ label: "Entry", suggestions: [], placeholder: "Type to filter", listAll: true, onPick: (picked) => this.pick(this.byValue.get(picked.value)) });
  private readonly browseSlot = renderElement("span", { class: "ls-consult-browse-slot" });
  private readonly cancel = renderTextButton("Cancel", "ls-btn");
  private readonly dialog;

  constructor(private readonly options: ConsultChooserOptions) {
    this.kind = options.memory?.kind ?? "paper";
    this.dialog = renderPickerDialog({
      heading: "Consult",
      pickers: [{ label: "Show", control: this.renderKinds() }, { label: "Entry", control: this.picker.root }],
      leading: [...this.renderLinkOutput(), this.browseSlot], trailing: [this.cancel], onDismiss: () => { this.done = true; this.picker.dispose(); },
    });
    this.cancel.addEventListener("click", () => this.close());

    this.syncKinds();
    void this.load();
  }

  close(): void {
    if (this.done) { return; }
    this.done = true;
    this.picker.dispose();
    this.dialog.close();
  }

  /** Link output…, for a surface that links outputs: they are linked from their own popup, so the button closes the chooser first. */
  private renderLinkOutput(): HTMLElement[] {
    const { onLinkOutput } = this.options;
    if (!onLinkOutput) return [];
    const link = renderTextButton("Link output...", "ls-btn");
    link.title = "Link a figure, table or value from a code repository";
    link.addEventListener("click", () => { this.close(); onLinkOutput(); });
    return [link];
  }

  private renderKinds(): HTMLElement {
    const group = renderElement("div", { class: "ls-consult-kinds", role: "radiogroup", "aria-label": "What to consult" });
    for (const { kind, label } of KINDS) {
      const button = renderElement("button", { type: "button", class: "ls-consult-kind", role: "radio", "aria-checked": "false", text: label });
      button.addEventListener("click", () => this.switchTo(kind));
      button.addEventListener("keydown", (event) => this.onKindKey(event, kind));
      this.buttons.set(kind, button);
      group.append(button);
    }
    return group;
  }

  private onKindKey(event: KeyboardEvent, kind: ConsultKind): void {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) { return; }
    event.preventDefault();
    const at = KINDS.findIndex((each) => each.kind === kind);
    const next = KINDS[(at + step + KINDS.length) % KINDS.length]!.kind;
    this.switchTo(next);
    this.buttons.get(next)?.focus();
  }

  private syncKinds(): void {
    for (const [kind, button] of this.buttons) {
      button.setAttribute("aria-checked", String(kind === this.kind));
      button.tabIndex = kind === this.kind ? 0 : -1;
    }
  }

  private switchTo(kind: ConsultKind): void {
    if (this.done || kind === this.kind) { return; }
    this.kind = kind;
    if (this.options.memory) { this.options.memory.kind = kind; }
    this.syncKinds();
    void this.load();
  }

  private setBrowse(canBrowse: boolean): void {
    this.browseSlot.replaceChildren();
    if (!canBrowse || this.kind !== "code") { return; }
    const button = renderTextButton("Browse...", "ls-btn");
    button.title = "Pick a code file anywhere on this computer";
    button.addEventListener("click", () => void this.browse());
    this.browseSlot.append(button);
  }

  private fail(error: unknown): void {
    this.dialog.showStatus(errorSentence(error), true);
    this.options.onError?.(error);
  }

  private async load(): Promise<void> {
    const seq = ++this.seq;
    this.setBrowse(false);
    this.byValue = new Map();
    this.picker.setSuggestions([]);
    this.picker.input.value = "";
    this.dialog.showStatus("Listing…");
    try {
      const value = await askConsult(this.options.client, { kind: "list", what: this.kind });
      if (this.done || seq !== this.seq) { return; }
      if (value.kind !== "entries") { throw new Error("The host answered the list with something else."); }
      const shown = toSuggestions(value.entries);
      this.byValue = shown.byValue;
      this.picker.setSuggestions(shown.suggestions);
      this.setBrowse(value.canBrowse);
      this.dialog.showStatus(value.entries.length === 0 && !value.canBrowse ? "Nothing to consult here." : "");
    } catch (error) {
      if (this.done || seq !== this.seq) { return; }
      this.fail(error);
    }
  }

  private async browse(): Promise<void> {
    const seq = this.seq;
    try {
      const value = await askConsult(this.options.client, { kind: "browse" });
      if (this.done || seq !== this.seq) { return; }
      if (value.kind !== "picked") { throw new Error("The host answered Browse with something else."); }
      if (value.entry) { this.pick(value.entry); } else { this.dialog.showStatus(""); }
    } catch (error) {
      if (this.done || seq !== this.seq) { return; }
      this.fail(error);
    }
  }

  private pick(entry: ConsultEntry | undefined): void {
    if (this.done || !entry) { return; }
    this.close();
    this.options.onPick(entry);
  }
}

/** Opens the chooser; `close()` removes it without picking. */
export function openConsultChooser(options: ConsultChooserOptions): { close(): void } {
  const chooser = new ConsultChooser(options);
  return { close: () => chooser.close() };
}
