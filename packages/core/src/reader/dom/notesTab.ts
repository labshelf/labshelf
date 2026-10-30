// Lists compact PDF note previews and opens one full editor at a time, preserving edits through navigation.
import type { Annotation } from "../../model/index.js";
import { createDebouncer, type Debouncer } from "../../async/index.js";
import type { CellRunState } from "../../qmd/compute/index.js";
import { ReaderCellRuns } from "./cellRuns.js";
import { mountQmdEditor, QMD_VOCABULARY, type QmdEditorHandle } from "../../qmd/dom/index.js";
import { parseAnchor, sameItemBody } from "../../qmd/item/index.js";
import { renderIcon } from "../../ui/index.js";
import { renderElement } from "../../ui/dom/index.js";
import type { ReaderNote } from "../protocol/index.js";
import { renderReaderIconButton } from "./elements.js";
import type { HostBridge, ReaderContext } from "./readerSession.js";
import type { SidebarPanel } from "./sidebar.js";

const SAVE_DELAY_MS = 400;
const ITEM = QMD_VOCABULARY.item;
const ITEMS = `${ITEM}s`;
type Filter = "all" | "page" | "highlights" | "boxes" | "unanchored";
type PlacementKind = "highlight" | "point" | "box" | "none";
interface Placement { page: number | null; kind: PlacementKind; label: string; annotation?: Annotation | undefined; quote?: string | undefined }
interface ActiveNote { id: string; editor: QmdEditorHandle; root: HTMLElement; latest: string; lastSent: string; save: Debouncer<[]> }
const FILTERS: ReadonlyArray<[Filter, string]> = [["all", "All"], ["page", "This page"], ["highlights", "Highlights"], ["boxes", "Text boxes"], ["unanchored", "Unanchored"]];
const KIND_ICON: Partial<Record<PlacementKind, [string, string]>> = { point: ["pin", "Page note"], box: ["text-box", "Text box"] };

export class NotesTab implements SidebarPanel {
  readonly el = renderElement("div", { class: "rd-panel rd-notes", role: "tabpanel" });
  onReveal: (() => void) | null = null;
  private readonly count = renderElement("span", { class: "rd-notes-count" }, "0");
  private readonly select = renderElement("select", { class: "rd-notes-filter", "aria-label": "Show" });
  private readonly search = renderElement("input", { class: "rd-notes-search", type: "search", placeholder: `Search ${ITEMS}`, "aria-label": `Filter ${ITEMS}` });
  private readonly filters = renderElement("div", { class: "rd-notes-filters" },
    renderElement("label", { class: "rd-notes-search-field" }, renderElement("span", { class: "rd-notes-field-icon", html: renderIcon("search"), "aria-hidden": "true" }), this.search),
    renderElement("label", { class: "rd-notes-filter-field" }, this.select, renderElement("span", { class: "rd-notes-field-icon", html: renderIcon("chevron-down"), "aria-hidden": "true" })),
    this.count);
  private readonly list = renderElement("div", { class: "rd-notes-list", "aria-label": "Notes" });
  private readonly pane = renderElement("div", { class: "rd-notes-editor-pane", hidden: true });
  private readonly status = renderElement("span", { class: "rd-note-save-status", role: "status", "aria-live": "polite" });
  private readonly source = renderElement("button", { class: "rd-note-source", type: "button" });
  private readonly context = renderElement("div", { class: "rd-note-context" });
  private readonly remove = renderReaderIconButton(renderIcon("trash"), `Delete ${ITEM}`, "rd-btn-sm rd-note-delete");
  private readonly quoteObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => this.measureQuote());
  private readonly drafts = new Map<string, string>();
  private notes: readonly ReaderNote[] = [];
  private annotations = new Map<string, Annotation>();
  private active: ActiveNote | null = null;
  private confirming = false;
  private quoteOpen = false;
  private listScroll = 0;
  private readonly runs: ReaderCellRuns;

  constructor(private readonly host: HostBridge, private readonly goToPage: (page: number) => void, private readonly currentPage: () => number, eventBus: ReaderContext["eventBus"]) {
    this.runs = new ReaderCellRuns(host);
    for (const [value, label] of FILTERS) { this.select.append(renderElement("option", { value }, label)); }
    this.el.append(this.filters, this.list, this.pane);
    this.select.addEventListener("change", () => this.renderList());
    this.search.addEventListener("input", () => this.renderList());
    this.list.addEventListener("scroll", () => { if (!this.list.hidden) { this.listScroll = this.list.scrollTop; } }, { passive: true });
    eventBus.on("pagechanging", () => { if (this.select.value === "page") { this.renderList(); } });
    this.source.addEventListener("click", () => { const page = Number(this.source.dataset["page"]); if (page) { this.goToPage(page); } });
    this.remove.addEventListener("click", () => this.deleteActive());
    this.remove.addEventListener("blur", () => this.confirmDelete(false));
    this.renderList();
  }

  onShow(): void { this.renderList(); }
  onHide(): void { this.flush(); }

  setAnnotations(annotations: readonly Annotation[]): void {
    this.annotations = new Map(annotations.map((item) => [item.id, item]));
    this.renderList();
    this.renderContext();
  }

  show(notes: readonly ReaderNote[]): void {
    this.active?.editor.flush();
    this.notes = notes;
    for (const [id, body] of this.drafts) {
      const note = notes.find((item) => item.id === id);
      if (!note || sameItemBody(note.body, body)) { this.drafts.delete(id); }
    }
    const active = this.active;
    const stored = notes.find((item) => item.id === active?.id);
    if (active && !stored) { this.closeEditor(false); }
    if (active && stored) {
      if (!this.drafts.has(active.id) && !sameItemBody(active.latest, stored.body)) {
        active.latest = stored.body;
        active.lastSent = stored.body;
        active.editor.setBody(stored.body);
      }
      this.status.textContent = this.drafts.has(active.id) ? "Saving…" : "Saved";
    }
    this.renderList();
    this.renderContext();
  }

  setCanRunCells(canRun: boolean): void {
    if (!this.runs.setCanRun(canRun)) { return; }
    const id = this.active?.id;
    this.closeEditor();
    if (id) { this.reveal(id); }
  }

  showCellState(requestId: string, state: CellRunState): void { this.runs.show(requestId, state); }

  /** Opens the selected note; pending edits are sent before another editor is mounted. */
  reveal(id: string, body?: string): void {
    if (this.active?.id === id && body === undefined) { this.onReveal?.(); this.active.editor.focus(); return; }
    if (!this.list.hidden) { this.listScroll = this.list.scrollTop; }
    this.closeEditor();
    const note = this.notes.find((item) => item.id === id);
    if (!note) { return; }
    if (body !== undefined && !sameItemBody(body, note.body)) { this.drafts.set(id, body); }
    const latest = this.drafts.get(id) ?? note.body;
    const root = renderElement("div", { class: "rd-note-editor" });
    const back = renderReaderIconButton(renderIcon("arrow-left"), "All notes", "rd-btn-sm rd-notes-back");
    back.addEventListener("click", () => this.closeEditor());
    this.quoteOpen = false;
    this.pane.replaceChildren(renderElement("div", { class: "rd-notes-editor-nav" }, back, this.source, this.status, this.remove), this.context, root);
    const save = createDebouncer(() => this.send(active), SAVE_DELAY_MS);
    const active: ActiveNote = { id, root, latest, lastSent: latest, save, editor: mountQmdEditor(root, {
      body: latest,
      onChange: (next) => { active.latest = next; this.drafts.set(id, next); this.status.textContent = "Saving…"; save.call(); },
      ...this.runs.option(id, root),
    }) };
    this.active = active;
    this.confirmDelete(false);
    this.status.textContent = this.drafts.has(id) ? "Saving…" : "Saved";
    this.filters.hidden = this.list.hidden = true;
    this.pane.hidden = false;
    this.renderContext();
    this.onReveal?.();
    active.editor.focus();
  }

  private flush(): void { this.active?.editor.flush(); this.active?.save.flush(); }

  private closeEditor(save = true): void {
    const id = this.active?.id;
    if (save) { this.flush(); }
    this.active?.save.cancel();
    this.active?.editor.destroy();
    this.active = null;
    this.quoteObserver?.disconnect();
    this.pane.replaceChildren();
    this.pane.hidden = true;
    this.filters.hidden = this.list.hidden = false;
    this.renderList();
    if (save && id) { this.list.querySelectorAll<HTMLButtonElement>(".rd-note-preview").forEach((button) => { if (button.dataset["noteId"] === id) { button.focus({ preventScroll: true }); } }); }
  }

  private send(active: ActiveNote): void {
    if (sameItemBody(active.latest, active.lastSent)) { return; }
    active.lastSent = active.latest;
    this.host.post({ command: "editNote", id: active.id, body: active.latest });
  }

  private place(note: ReaderNote): Placement {
    const anchor = parseAnchor(note.anchor);
    if (anchor.kind === "highlight") {
      const annotation = this.annotations.get(anchor.annotationId);
      return { page: annotation?.pageNumber ?? null, kind: "highlight", label: annotation ? "Highlight" : "Highlight not found", annotation, quote: annotation?.content };
    }
    if (anchor.kind === "point" || anchor.kind === "box") { return { page: anchor.page, kind: anchor.kind, label: anchor.kind === "point" ? "Page note" : "Text box" }; }
    return { page: null, kind: "none", label: "Unanchored", quote: anchor.kind === "quote" ? anchor.quote : undefined };
  }

  private matches(note: ReaderNote): boolean {
    const placement = this.place(note);
    const query = this.search.value.trim().toLowerCase();
    if (query && !(this.drafts.get(note.id) ?? note.body).toLowerCase().includes(query)) { return false; }
    switch (this.select.value as Filter) {
      case "page": return placement.page === this.currentPage();
      case "highlights": return placement.kind === "highlight";
      case "boxes": return placement.kind === "box";
      case "unanchored": return placement.page === null;
      default: return true;
    }
  }

  private renderList(): void {
    const focused = this.list.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset["noteId"] : undefined;
    const visible = this.notes.filter((note) => this.matches(note)).sort((a, b) => (this.place(a).page ?? Infinity) - (this.place(b).page ?? Infinity) || a.created.localeCompare(b.created));
    const filtered = visible.length !== this.notes.length;
    this.count.textContent = filtered ? `${visible.length}/${this.notes.length}` : String(this.notes.length);
    this.count.title = filtered ? `${visible.length} of ${this.notes.length} ${ITEMS} shown` : `${this.notes.length} ${this.notes.length === 1 ? ITEM : ITEMS}`;
    const children: HTMLElement[] = [];
    let previous = "";
    for (const note of visible) {
      const placement = this.place(note);
      const group = placement.page === null ? "Unanchored" : `Page ${placement.page}`;
      if (group !== previous) { children.push(renderElement("div", { class: "rd-notes-group" }, group)); previous = group; }
      children.push(this.preview(note, placement));
    }
    if (!children.length) { children.push(this.renderEmpty()); }
    this.list.replaceChildren(...children);
    this.list.scrollTop = this.listScroll;
    if (focused) { children.find((child) => child.dataset["noteId"] === focused)?.focus({ preventScroll: true }); }
  }

  private renderEmpty(): HTMLElement {
    const icon = renderElement("span", { class: "rd-notes-empty-icon", html: renderIcon("note"), "aria-hidden": "true" });
    if (!this.notes.length) {
      return renderElement("div", { class: "rd-empty rd-notes-empty" }, icon, renderElement("strong", {}, "No notes yet"), renderElement("span", {}, "Select a passage and add a note, or use Add note in the toolbar to pin one to a page."));
    }
    const clear = renderElement("button", { class: "rd-notes-clear", type: "button" }, "Show all notes");
    clear.addEventListener("click", () => { this.search.value = ""; this.select.value = "all"; this.renderList(); this.search.focus(); });
    return renderElement("div", { class: "rd-empty rd-notes-empty" }, icon, renderElement("strong", {}, "No matching notes"), clear);
  }

  private preview(note: ReaderNote, placement: Placement): HTMLElement {
    const { title, body } = derivePreview(this.drafts.get(note.id) ?? note.body);
    const kind = KIND_ICON[placement.kind];
    const accent = placement.annotation ? `rd-color-${placement.annotation.color ?? "note"}` : "";
    const button = renderElement("button", { class: "rd-note-preview", type: "button", "data-note-id": note.id },
      renderElement("span", { class: `rd-note-accent ${accent}`.trim(), "aria-hidden": "true" }),
      renderElement("span", { class: "rd-note-preview-text" },
        placement.quote ? renderElement("span", { class: "rd-note-preview-quote" }, placement.quote) : null,
        renderElement("span", { class: "rd-note-preview-head" },
          renderElement("span", { class: "rd-note-preview-title" }, title || "Empty note"),
          kind ? renderElement("span", { class: "rd-note-preview-kind", role: "img", "aria-label": kind[1], title: kind[1], html: renderIcon(kind[0] as Parameters<typeof renderIcon>[0]) }) : null),
        body ? renderElement("span", { class: "rd-note-preview-body" }, body) : (title ? null : renderElement("span", { class: "rd-note-preview-body" }, "Start writing…"))));
    button.addEventListener("click", () => this.reveal(note.id));
    return button;
  }

  private renderContext(): void {
    const note = this.notes.find((item) => item.id === this.active?.id);
    if (!note) { return; }
    const placement = this.place(note);
    const marker = placement.annotation
      ? renderElement("span", { class: `rd-ann-dot rd-color-${placement.annotation.color ?? "note"}`, "aria-hidden": "true" })
      : renderElement("span", { class: "rd-note-source-icon", html: renderIcon((KIND_ICON[placement.kind]?.[0] ?? "note") as Parameters<typeof renderIcon>[0]), "aria-hidden": "true" });
    this.source.replaceChildren(marker, renderElement("span", { class: "rd-note-source-label" }, placement.page === null ? placement.label : `p. ${placement.page} · ${placement.label}`));
    this.source.disabled = placement.page === null;
    this.source.dataset["page"] = String(placement.page ?? "");
    this.source.title = placement.page === null ? placement.label : `Go to page ${placement.page}`;
    this.quoteObserver?.disconnect();
    if (!placement.quote) { this.context.replaceChildren(); return; }
    const quote = renderElement("blockquote", { class: `rd-note-quote${this.quoteOpen ? "" : " is-clamped"}` },
      renderElement("span", { class: `rd-note-accent ${placement.annotation ? `rd-color-${placement.annotation.color ?? "note"}` : ""}`.trim(), "aria-hidden": "true" }),
      renderElement("span", { class: "rd-note-quote-text" }, placement.quote));
    const toggle = renderElement("button", { class: "rd-note-quote-toggle", type: "button", hidden: true, "aria-expanded": String(this.quoteOpen) }, this.quoteOpen ? "Show less" : "Show more");
    toggle.addEventListener("click", () => { this.quoteOpen = !this.quoteOpen; this.renderContext(); });
    this.context.replaceChildren(quote, toggle);
    this.quoteObserver?.observe(quote);
  }

  /** Offers the expand toggle only when the clamped quote actually hides text, or after it was expanded. */
  private measureQuote(): void {
    const text = this.context.querySelector<HTMLElement>(".rd-note-quote-text");
    const toggle = this.context.querySelector<HTMLButtonElement>(".rd-note-quote-toggle");
    if (!text || !toggle) { return; }
    toggle.hidden = !this.quoteOpen && text.scrollHeight <= text.clientHeight + 1;
  }


  private deleteActive(): void {
    if (!this.active) { return; }
    this.active.editor.flush();
    if (this.active.latest.trim() && !this.confirming) { this.confirmDelete(true); return; }
    this.active.save.cancel();
    this.host.post({ command: "removeNote", id: this.active.id });
  }

  private confirmDelete(on: boolean): void {
    this.confirming = on;
    this.remove.classList.toggle("rd-danger", on);
    this.remove.title = on ? "Click again to delete this note" : `Delete ${ITEM}`;
    this.remove.setAttribute("aria-label", this.remove.title);
  }
}

const TEX_SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ",
  pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ",
  Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω", cdot: "·", times: "×", pm: "±", le: "≤", leq: "≤", ge: "≥", geq: "≥", neq: "≠", ne: "≠",
  approx: "≈", sim: "~", infty: "∞", sum: "Σ", prod: "Π", int: "∫", partial: "∂", nabla: "∇", to: "→", rightarrow: "→", leftarrow: "←", in: "∈",
  ldots: "…", cdots: "…", quad: " ", qquad: " ", left: "", right: "",
};

/** Reads TeX as plain text for a one-line preview: common commands become symbols and grouping braces are dropped. */
function formatTexPlain(tex: string): string {
  let text = tex.replace(/\\(?:operatorname|mathrm|mathbf|mathit|mathcal|mathbb|text|textbf|textit)\s*\{([^{}]*)\}/g, "$1");
  for (let i = 0; i < 3; i += 1) {
    text = text.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)").replace(/\\sqrt\s*\{([^{}]*)\}/g, (_, inner: string) => /^\w+$/.test(inner) ? `√${inner}` : `√(${inner})`);
  }
  text = text.replace(/\\([a-zA-Z]+)/g, (_, name: string) => TEX_SYMBOLS[name] ?? name).replace(/\\[,;:! ]/g, " ").replace(/[{}]/g, "");
  return text.replace(/\s+/g, " ").trim();
}

/** Reads inline Markdown as plain text: math loses its delimiters, links keep their text and emphasis marks go. */
function formatInlinePlain(line: string): string {
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\$([^$]+)\$/g, (_, tex: string) => formatTexPlain(tex))
    .replace(/(\*\*|__|\*|`)/g, "")
    .replace(/\s+/g, " ").trim();
}

/** Derives a list preview from a note body: the first readable line is the title, the rest the body. Code and equations count as text. */
function derivePreview(body: string): { title: string; body: string } {
  const lines: string[] = [];
  let first: "text" | "code" | "math" | null = null;
  let fence: string | null = null;
  let math = false;
  let skipDiv = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (skipDiv) { if (/^:::\s*$/.test(line) && fence === null) { skipDiv = false; } else if (/^(`{3,}|~{3,})/.test(line)) { fence = fence ? null : line; } continue; }
    if (fence !== null) {
      if (line.startsWith(fence.slice(0, 3)) && /^(`{3,}|~{3,})\s*$/.test(line)) { fence = null; continue; }
      if (line && !line.startsWith("#|")) { lines.push(line.replace(/\s+/g, " ")); }
      continue;
    }
    if (/^(`{3,}|~{3,})/.test(line)) { fence = line; first ??= "code"; continue; }
    if (/^:::.*labshelf-output/.test(line)) { skipDiv = true; continue; }
    if (/^:::/.test(line)) { continue; }
    if (line.startsWith("$$")) {
      first ??= "math";
      const single = /^\$\$(.+)\$\$$/.exec(line);
      if (single) { lines.push(formatTexPlain(single[1]!)); continue; }
      math = !math;
      const rest = line.replace(/\$\$/g, "").trim();
      if (rest) { lines.push(formatTexPlain(rest)); }
      continue;
    }
    if (math) {
      const end = line.endsWith("$$");
      const tex = formatTexPlain(line.replace(/\$\$$/, ""));
      if (tex) { lines.push(tex); }
      if (end) { math = false; }
      continue;
    }
    const text = formatInlinePlain(line.replace(/^(#{1,6}\s+|>\s*|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, ""));
    if (text) { first ??= "text"; lines.push(text); }
  }
  const fallback = first === "code" ? "Code note" : first === "math" ? "Equation note" : "";
  return { title: lines[0] ?? fallback, body: lines.slice(1).join(" ") };
}
