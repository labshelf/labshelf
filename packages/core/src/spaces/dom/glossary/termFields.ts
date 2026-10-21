// Builds labelled manual term inputs with optional source selection.
import { el } from "../../../ui/dom/index.js";
import type { GlossaryTerm } from "../../model/index.js";
import type { PaperPickItem } from "../../protocol/index.js";

export function termFields(term?: GlossaryTerm) {
  const name = el("input", { class: "ls-input", name: "term", required: true, value: term?.term ?? "" });
  const definition = el("textarea", { class: "ls-input", name: "definition", required: true, tabindex: "0", text: term?.definition ?? "" });
  const symbol = el("input", { class: "ls-input", name: "symbol", value: term?.symbol ?? "" });
  const paper = el("select", { class: "ls-input", name: "paperId", tabindex: "0" });
  const page = el("input", { class: "ls-input", type: "number", name: "page", min: "1", step: "1", value: term?.source?.page?.toString() ?? "" });
  let initialized = false;
  const paintPapers = (papers: readonly PaperPickItem[], loaded = true): void => {
    const selected = initialized ? paper.value : term?.source?.paperId ?? "";
    initialized = true;
    paper.replaceChildren(el("option", { value: "", text: "No source paper" }));
    if (selected && !papers.some(item => item.id === selected)) paper.append(el("option", { value: selected, text: loaded ? `${selected} — Not in your Library` : selected }));
    for (const item of papers) paper.append(el("option", { value: item.id, text: item.title }));
    paper.value = selected;
    page.disabled = !selected;
  };
  paper.addEventListener("change", () => { page.disabled = !paper.value; if (!paper.value) page.value = ""; });
  const body = el("div", { class: "gl-fields" },
    el("label", {}, "Term", name), el("label", {}, "Definition", definition), el("label", {}, "Symbol (optional)", symbol),
    el("label", {}, "Source paper (optional)", paper), el("label", {}, "Page (optional)", page));
  paintPapers([], false);
  return { body, name, definition, symbol, paper, page, paintPapers };
}
