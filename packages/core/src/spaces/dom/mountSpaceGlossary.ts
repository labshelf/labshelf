// Keeps the Glossary surface synchronized while preserving unfinished dialogs.
import { renderElement, renderEmptyNotice, setPlannedNotice, renderIcon, mountOverlay, mountFormDialog } from "../../ui/dom/index.js";
import type { GlossaryTerm } from "../model/index.js";
import { type PaperPickItem, parseTermDraft } from "../spacesProtocol.js";
import { renderOverviewAction, type OverviewContext, type SpaceBody } from "./mountOverview.js";
import type { PapersTree } from "../spaceViews.js";

function termList(ctx: OverviewContext, edit: (term: GlossaryTerm) => void, remove: (term: GlossaryTerm) => void, papers?: readonly PaperPickItem[]): HTMLElement {
  const terms = ctx.data.glossary.terms;
  const counts = new Map<string, number>();
  for (const term of terms) { const key = symbolKey(term); if (key) counts.set(key, (counts.get(key) ?? 0) + 1); }
  const list = renderElement("ul", { class: "gl-list" });
  for (const term of terms) {
    const conflict = (counts.get(symbolKey(term)) ?? 0) > 1;
    const body = renderElement("div", { class: "gl-term-body" },
      conflict ? renderElement("div", { class: "gl-flag" }, renderElement("span", { html: renderIcon("warning") }), "Another term uses this symbol.") : null,
      renderElement("div", { class: "gl-term-head" }, renderElement("span", { class: "gl-term-name", text: term.term })),
      renderElement("div", { class: "gl-def", text: term.definition }));
    if (term.source) {
      const title = papers ? papers.find(paper => paper.id === term.source!.paperId)?.title
        : paperTitle(ctx.data.papers, term.source.paperId);
      const label = `${title ?? term.source.paperId}${term.source.page === undefined ? "" : `, p. ${term.source.page}`}`;
      const source = renderOverviewAction(label, () => ctx.end.post({ type: "openPaper", paperId: term.source!.paperId }));
      source.classList.add("gl-src-link"); source.title = label;
      body.append(renderElement("div", { class: "gl-src" }, source, papers && !title ? renderElement("span", { text: "Not in your Library" }) : null));
    }
    body.append(renderElement("div", { class: "gl-actions" }, renderOverviewAction("Edit", () => edit(term), ctx.readOnly),
      renderOverviewAction("Delete", () => remove(term), ctx.readOnly)));
    list.append(renderElement("li", { class: `gl-term${conflict ? " conflict" : ""}` }, renderElement("div", { class: "gl-term-not", text: term.symbol ?? "" }), body));
  }
  return list;
}
const symbolKey = (term: GlossaryTerm): string => term.symbol?.normalize("NFKC").trim().toLowerCase() ?? "";
function paperTitle(tree: PapersTree, id: string): string | undefined {
  const paper = tree.papers.find(item => item.id === id);
  if (paper && !paper.missing) return paper.title;
  for (const folder of tree.folders) { const title = paperTitle(folder, id); if (title) return title; }
  return undefined;
}

function termFields(term?: GlossaryTerm) {
  const name = renderElement("input", { class: "ls-input", name: "term", required: true, value: term?.term ?? "" });
  const definition = renderElement("textarea", { class: "ls-input", name: "definition", required: true, tabindex: "0", text: term?.definition ?? "" });
  const symbol = renderElement("input", { class: "ls-input", name: "symbol", value: term?.symbol ?? "" });
  const paper = renderElement("select", { class: "ls-input", name: "paperId", tabindex: "0" });
  const page = renderElement("input", { class: "ls-input", type: "number", name: "page", min: "1", step: "1", value: term?.source?.page?.toString() ?? "" });
  let initialized = false;
  const paintPapers = (papers: readonly PaperPickItem[], loaded = true): void => {
    const selected = initialized ? paper.value : term?.source?.paperId ?? "";
    initialized = true;
    paper.replaceChildren(renderElement("option", { value: "", text: "No source paper" }));
    if (selected && !papers.some(item => item.id === selected)) paper.append(renderElement("option", { value: selected, text: loaded ? `${selected} — Not in your Library` : selected }));
    for (const item of papers) paper.append(renderElement("option", { value: item.id, text: item.title }));
    paper.value = selected;
    page.disabled = !selected;
  };
  paper.addEventListener("change", () => { page.disabled = !paper.value; if (!paper.value) page.value = ""; });
  const body = renderElement("div", { class: "gl-fields" },
    renderElement("label", {}, "Term", name), renderElement("label", {}, "Definition", definition), renderElement("label", {}, "Symbol (optional)", symbol),
    renderElement("label", {}, "Source paper (optional)", paper), renderElement("label", {}, "Page (optional)", page));
  paintPapers([], false);
  return { body, name, definition, symbol, paper, page, paintPapers };
}

function termDialog(ctx: OverviewContext, term?: GlossaryTerm): () => void {
  const fields = termFields(term);
  const error = renderElement("p", { role: "alert", class: "gl-error" });
  const label = term ? "Edit term" : "Add term";
  const form = renderElement("form", { class: "ls-dialog gl-dialog", role: "dialog", "aria-modal": "true", "aria-label": label, novalidate: true },
    renderElement("h2", { text: label }), fields.body, error);
  const unsubscribe = ctx.end.subscribe(message => { if (message.type === "papers") fields.paintPapers(message.items); });
  const close = mountFormDialog(form, { submitLabel: "Save", unsubscribe, ...(ctx.signal ? { signal: ctx.signal } : {}) });
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (ctx.readOnly || ctx.signal?.aborted) return;
    const draft = readDraft(fields, error);
    if (!draft) return;
    ctx.end.post(term ? { type: "updateTerm", id: ctx.data.space.id, termId: term.id, term: draft }
      : { type: "addTerm", id: ctx.data.space.id, term: draft });
    close();
  });
  fields.name.focus(); ctx.end.post({ type: "listPapers" });
  return close;
}

function readDraft(fields: ReturnType<typeof termFields>, error: HTMLElement) {
  const name = fields.name.value.trim();
  const definition = fields.definition.value.trim();
  fields.name.setAttribute("aria-invalid", String(!name));
  fields.definition.setAttribute("aria-invalid", String(!definition));
  if (!name || !definition) { error.textContent = "Enter a term and definition."; return undefined; }
  const page = fields.page.value ? Number(fields.page.value) : undefined;
  const draft = parseTermDraft({ term: name, definition,
    ...(fields.symbol.value.trim() ? { symbol: fields.symbol.value.trim() } : {}),
    ...(fields.paper.value ? { source: { paperId: fields.paper.value, ...(page === undefined ? {} : { page }) } } : {}),
  });
  if (!draft) error.textContent = "Enter a whole page number greater than zero.";
  return draft;
}

function deleteTerm(ctx: OverviewContext, term: GlossaryTerm): () => void {
  const box = renderElement("div", { class: "ls-dialog", role: "alertdialog", "aria-modal": "true", "aria-label": "Delete term" },
    renderElement("div", { class: "ls-dialog-head" }, renderElement("span", { html: renderIcon("warning") }),
      renderElement("div", {}, renderElement("div", { class: "ls-dialog-title", text: "Delete term?" }),
        renderElement("div", { class: "ls-dialog-msg", text: `Delete “${term.term}” from this Space's glossary?` }))));
  const overlay = mountOverlay(box, () => {}, ctx.signal ? { signal: ctx.signal } : {});
  const cancel = renderElement("button", { class: "ls-btn", type: "button", text: "Cancel" });
  const remove = renderElement("button", { class: "ls-btn ls-btn-danger", type: "button", text: "Delete" });
  cancel.addEventListener("click", overlay.close);
  remove.addEventListener("click", () => {
    if (!ctx.readOnly && !ctx.signal?.aborted) ctx.end.post({ type: "removeTerm", id: ctx.data.space.id, termId: term.id });
    overlay.close();
  });
  box.append(renderElement("div", { class: "ls-dialog-actions" }, cancel, remove));
  cancel.focus();
  return overlay.close;
}

export function mountSpaceGlossary(root: HTMLElement, initial: OverviewContext): SpaceBody {
  let controller = new AbortController();
  const ctx = { ...initial, readOnly: locked(initial), signal: controller.signal };
  let papers: readonly PaperPickItem[] | undefined;
  let closeDialog: (() => void) | undefined;
  const edit = (term?: GlossaryTerm): void => { closeDialog?.(); closeDialog = termDialog(ctx, term); };
  const remove = (term: GlossaryTerm): void => { closeDialog?.(); closeDialog = deleteTerm(ctx, term); };
  const render = (): void => {
    const add = renderOverviewAction("Add term", () => edit(), ctx.readOnly);
    const main = renderElement("section", { class: "gl-main", "aria-label": "Glossary" },
      renderElement("div", { class: "gl-bar" }, renderElement("h2", { text: "Glossary" }), add));
    const reason = ctx.data.readOnlyReason ?? ctx.data.glossary.readOnlyReason;
    if (reason) main.append(renderElement("p", { role: "status", text: reason }));
    main.append(ctx.data.glossary.terms.length ? termList(ctx, edit, remove, papers)
      : renderEmptyNotice({ text: "No terms yet.", hint: "Add a term, its definition and an optional paper source." }));
    root.replaceChildren(renderElement("div", { class: "gl-grid" }, main, plannedColumn()));
  };
  render();
  const unsubscribe = ctx.end.subscribe(message => {
    if (message.type === "papers") { papers = message.items; render(); }
  });
  ctx.end.post({ type: "listPapers" });
  return {
    update(data) {
      ctx.data = data; ctx.readOnly = !!data.readOnlyReason || !!data.glossary.readOnlyReason;
      if (ctx.readOnly) { closeDialog?.(); controller.abort(); controller = new AbortController(); ctx.signal = controller.signal; }
      render();
    },
    dispose() { unsubscribe(); closeDialog?.(); controller.abort(); root.replaceChildren(); },
  };
}
function locked(ctx: OverviewContext): boolean {
  return ctx.readOnly || !!ctx.data.readOnlyReason || !!ctx.data.glossary.readOnlyReason;
}
function plannedColumn(): HTMLElement {
  const suggest = renderOverviewAction("Find suggestions", () => {});
  setPlannedNotice(suggest, "Suggestions need paper text extraction");
  const generate = renderOverviewAction("Generate labshelf-glossary.tex", () => {});
  setPlannedNotice(generate, "Glossary file generation needs a connected writing project");
  return renderElement("aside", { class: "gl-side", "aria-label": "Glossary tools" },
    renderElement("h2", { class: "gl-side-title", text: "Suggested" }),
    renderEmptyNotice({ text: "No suggestions yet.", hint: "Suggestions appear here for review.", inline: true }), suggest,
    generate, renderElement("p", { class: "gl-gen-hint", text: "Generate macros and a list of symbols for a writing project." }));
}
