// The Link output popup of the source editor: pick a source (or add one), one of its files, see it, choose how a JSON file is
// linked (values or table) and a table's decimals, read what will be inserted, Link. Built on the picker shell of the cite popup.
// CONTRACT: documents/contracts/library-format.md#linked-outputs
import { extensionOf } from "../../../path/index.js";
import {
  FIGURE_OUTPUT_EXTENSIONS, IMAGE_OUTPUT_EXTENSIONS, LINKABLE_OUTPUT_EXTENSIONS, buildOutputInsert, deriveOutputCopyPath, formatOutputTable, isOutputSourceName, listOutputValueKeys, parseOutputTable,
  type OutputCreateInput, type OutputFormat, type OutputKind, type OutputLinks, type OutputSourcePort,
} from "../../outputLinks/index.js";
import { askInputBox, mountCombobox, renderElement, renderPickerDialog, renderTextButton } from "../../../ui/dom/index.js";

const NEW_SOURCE = "\u0000new";
const PREVIEW_ROWS = 8;

interface Shown { path: string; bytes: Uint8Array; keys: string[] }

type PickerDialog = ReturnType<typeof renderPickerDialog>;

function renderTable(rows: string[][]): HTMLElement {
  return renderElement("table", {}, ...rows.slice(0, PREVIEW_ROWS + 1).map((row) => renderElement("tr", {}, ...row.map((cell) => renderElement("td", { text: cell })))));
}

const imageMime = (extension: string): string => extension === ".svg" ? "image/svg+xml" : `image/${extension.slice(1).replace("jpg", "jpeg")}`;

/** The popup's state and controls; `result` settles once, when the popup closes. */
class OutputPicker {
  private source: string | undefined;
  private shown: Shown | undefined;
  private done = false;
  private readonly urls: string[] = [];
  private readonly sourcePicker = renderElement("select", { class: "ls-input", "aria-label": "Source" });
  private readonly decimals = renderElement("input", { class: "ls-input", type: "number", min: "0", max: "12", placeholder: "as written", "aria-label": "Decimals" });
  private readonly asValues = renderElement("input", { type: "radio", name: "ls-output-kind", checked: true });
  private readonly asTable = renderElement("input", { type: "radio", name: "ls-output-kind" });
  private readonly options = renderElement("div", { class: "ls-output-options" });
  private readonly preview = renderElement("div", { class: "ls-output-preview" });
  private readonly cancel = renderTextButton("Cancel", "ls-btn");
  private readonly link = renderTextButton("Link", "ls-btn ls-btn-primary");
  private readonly filePicker = mountCombobox({ label: "Output file", suggestions: [], placeholder: "Type to filter the files", listAll: true, onPick: (picked) => void this.showFile(picked.value) });
  private readonly dialog: PickerDialog;
  readonly result: Promise<OutputCreateInput | undefined>;
  private resolve!: (input: OutputCreateInput | undefined) => void;

  constructor(private readonly links: OutputLinks, private readonly sources: OutputSourcePort, private readonly format: OutputFormat, private readonly manuscriptPath: string) {
    this.result = new Promise((resolve) => { this.resolve = resolve; });
    this.dialog = renderPickerDialog({
      heading: "Link output", pickers: [{ label: "Source", control: this.sourcePicker }, { label: "File", control: this.filePicker.root }], leading: [], trailing: [this.cancel, this.link], onDismiss: () => this.finish(undefined),
    });
    this.dialog.body.append(renderElement("div", { class: "ls-output-pick" }, this.options, this.preview));
    this.bind();
    this.link.disabled = true;
    this.dialog.showStatus("Reading the linked sources…");
    void this.fillSources().catch((error: unknown) => { if (!this.done) this.dialog.showStatus(error instanceof Error ? error.message : String(error), true); });
  }

  private finish(input: OutputCreateInput | undefined): void {
    if (this.done) return;
    this.done = true;
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.dialog.close();
    this.resolve(input);
  }

  private bind(): void {
    this.sourcePicker.addEventListener("change", () => void (this.sourcePicker.value === NEW_SOURCE ? this.newSource() : this.showSource(this.sourcePicker.value)).catch((error: unknown) => this.dialog.showStatus(String(error), true)));
    for (const radio of [this.asValues, this.asTable]) radio.addEventListener("change", () => this.renderShown());
    this.decimals.addEventListener("input", () => this.renderShown());
    this.options.addEventListener("change", (event) => { if ((event.target as HTMLElement).dataset.key !== undefined) this.describe(); });
    this.cancel.addEventListener("click", () => this.finish(undefined));
    this.link.addEventListener("click", () => { const chosen = this.input(); if (chosen) this.finish(chosen); });
  }

  private kindOf(path: string): OutputKind {
    const extension = extensionOf(path);
    if (extension === ".csv" || extension === ".tsv") return "table";
    if (extension === ".json") return this.asTable.checked ? "table" : "values";
    return "file";
  }

  private pickedKeys(): string[] {
    return [...this.options.querySelectorAll<HTMLInputElement>("input[data-key]:checked")].map((box) => box.dataset.key!);
  }

  private places(): number | undefined {
    return this.decimals.value === "" ? undefined : Number(this.decimals.value);
  }

  private input(): OutputCreateInput | undefined {
    const { source, shown, manuscriptPath } = this;
    if (!source || !shown) return undefined;
    const kind = this.kindOf(shown.path);
    const places = this.places();
    if (kind === "values" && this.pickedKeys().length === 0) return undefined;
    return { source, path: shown.path, kind, manuscriptPath, ...(kind === "table" && places !== undefined ? { decimals: places } : {}), ...(kind === "values" ? { keys: this.pickedKeys() } : {}) };
  }

  /** The footer shows the exact text Link inserts. */
  private describe(): void {
    const chosen = this.input();
    this.link.disabled = chosen === undefined;
    if (!chosen) { if (this.shown) this.dialog.showStatus(this.kindOf(this.shown.path) === "values" ? "Pick the values to link" : ""); return; }
    const copy = deriveOutputCopyPath(chosen.source, chosen.path, chosen.kind, this.format, new Set());
    const draft = { id: "", source: chosen.source, path: chosen.path, kind: chosen.kind, copy, hash: "", updated: "", ...(chosen.keys ? { keys: chosen.keys } : {}) };
    this.dialog.showStatus(buildOutputInsert(draft, this.format, this.manuscriptPath).text);
  }

  private renderOptions(shown: Shown): void {
    if (extensionOf(shown.path) === ".json") {
      this.options.append(renderElement("label", {}, this.asValues, " Values"), renderElement("label", {}, this.asTable, " Table"));
      if (this.asValues.checked) {
        this.options.append(renderElement("div", { class: "ls-output-keys" }, ...shown.keys.map((key) =>
          renderElement("label", {}, renderElement("input", { type: "checkbox", "data-key": key }), ` ${key}`))));
      }
    }
    if (this.kindOf(shown.path) === "table") { this.options.append(renderElement("label", {}, "Decimals ", this.decimals)); }
  }

  private renderPreview(shown: Shown): void {
    const extension = extensionOf(shown.path);
    const text = (): string => new TextDecoder().decode(shown.bytes);
    if (this.kindOf(shown.path) === "table") {
      this.preview.append(renderTable(formatOutputTable(parseOutputTable(shown.path, text()), this.places()).rows));
    } else if (IMAGE_OUTPUT_EXTENSIONS.includes(extension)) {
      const url = URL.createObjectURL(new Blob([shown.bytes as Uint8Array<ArrayBuffer>], { type: imageMime(extension) }));
      this.urls.push(url);
      this.preview.append(renderElement("img", { src: url, alt: shown.path }));
    } else if (FIGURE_OUTPUT_EXTENSIONS.includes(extension)) {
      this.preview.append(renderElement("p", { text: `${extension.slice(1).toUpperCase()}, ${Math.ceil(shown.bytes.length / 1024)} KB: linked as a figure.` }));
    } else if (this.kindOf(shown.path) !== "values") {
      this.preview.append(renderElement("pre", { text: text().slice(0, 4000) }));
    }
  }

  /** The options and the preview of the file shown, for the kind it is linked as. */
  private renderShown(): void {
    const { shown } = this;
    if (!shown) return;
    this.options.replaceChildren();
    this.preview.replaceChildren();
    try {
      this.renderOptions(shown);
      this.renderPreview(shown);
    } catch (error) {
      this.preview.append(renderElement("p", { text: error instanceof Error ? error.message : String(error) }));
    }
    this.describe();
  }

  private async showFile(path: string): Promise<void> {
    const { source } = this;
    if (!source) return;
    this.shown = undefined;
    this.link.disabled = true;
    this.dialog.showStatus(`Reading ${path}…`);
    const bytes = await this.sources.read(source, path).catch(() => undefined);
    if (this.done) return;
    if (bytes === undefined) { this.dialog.showStatus(`Could not read ${path}`, true); return; }
    let keys: string[] = [];
    if (extensionOf(path) === ".json") { try { keys = listOutputValueKeys(JSON.parse(new TextDecoder().decode(bytes))); } catch { keys = []; } }
    this.filePicker.input.value = path;
    this.shown = { path, bytes, keys };
    this.renderShown();
  }

  /** Links the source to a folder on this computer when it is not; false when the source cannot be listed. */
  private async ensureLinked(name: string): Promise<boolean> {
    if (await this.sources.status(name).catch(() => undefined)) return true;
    this.dialog.showStatus("Linking the source to its folder on this computer…");
    const { folder, mismatch } = await this.links.linkSource(name);
    if (this.done) return false;
    if (folder === undefined) { this.dialog.showStatus(`${name} is not linked to code on this computer.`, true); return false; }
    if (mismatch) this.dialog.showStatus(`${folder} is a clone of ${mismatch.actual}, not ${mismatch.expected}.`, true);
    return true;
  }

  private async showSource(name: string): Promise<void> {
    this.source = name;
    this.shown = undefined;
    this.options.replaceChildren();
    this.preview.replaceChildren();
    this.link.disabled = true;
    if (!await this.ensureLinked(name)) return;
    this.dialog.showStatus(`Listing ${name}…`);
    const files = (await this.sources.list(name).catch(() => [])).filter((path) => LINKABLE_OUTPUT_EXTENSIONS.includes(extensionOf(path)));
    if (this.done) return;
    this.filePicker.setSuggestions(files.map((path) => ({ label: path, value: path })));
    this.dialog.showStatus(files.length === 0 ? `No outputs found in ${name}.` : "Pick an output file", files.length === 0);
    this.filePicker.input.focus();
  }

  private async newSource(): Promise<void> {
    const name = await askInputBox({ title: "New source", prompt: "A short name for the code repository, as experiments", validate: (value) => isOutputSourceName(value) ? undefined : "Start with a letter; letters, digits, '-' and '_' only." });
    if (name === undefined || this.done) return;
    const command = await askInputBox({ title: `Command for ${name}`, prompt: "Optional: the command that writes the outputs, run in the folder (as python run_all.py)" });
    if (this.done) return;
    if (await this.links.addSource(name, command) === undefined) return;
    await this.fillSources(name);
  }

  private async fillSources(selected?: string): Promise<void> {
    const names = Object.keys((await this.links.read()).file.sources).sort();
    this.sourcePicker.replaceChildren(...names.map((name) => renderElement("option", { value: name, text: name })), renderElement("option", { value: NEW_SOURCE, text: "New source…" }));
    const first = selected ?? names[0];
    if (first === undefined) { this.sourcePicker.value = NEW_SOURCE; this.dialog.showStatus("Add the code repository the outputs come from."); return; }
    this.sourcePicker.value = first;
    await this.showSource(first);
  }
}

/** Opens the popup; resolves with the link to create, or undefined when closed without linking. */
export function pickOutputLink(links: OutputLinks, sources: OutputSourcePort, format: OutputFormat, manuscriptPath: string): Promise<OutputCreateInput | undefined> {
  return new OutputPicker(links, sources, format, manuscriptPath).result;
}
