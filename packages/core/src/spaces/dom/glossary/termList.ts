// Renders manual terms with symbol conflicts and paper sources.
import { el, icon } from "../../../ui/dom/index.js";
import type { GlossaryTerm } from "../../model/index.js";
import type { PaperPickItem } from "../../protocol/index.js";
import type { PapersTree } from "../../view/index.js";
import { overviewAction, type OverviewContext } from "../overview/index.js";

export function termList(ctx: OverviewContext, edit: (term: GlossaryTerm) => void, remove: (term: GlossaryTerm) => void, papers?: readonly PaperPickItem[]): HTMLElement {
  const terms = ctx.data.glossary.terms;
  const counts = new Map<string, number>();
  for (const term of terms) { const key = symbolKey(term); if (key) counts.set(key, (counts.get(key) ?? 0) + 1); }
  const list = el("ul", { class: "gl-list" });
  for (const term of terms) {
    const conflict = (counts.get(symbolKey(term)) ?? 0) > 1;
    const body = el("div", { class: "gl-term-body" },
      conflict ? el("div", { class: "gl-flag" }, el("span", { html: icon("warning") }), "Another term uses this symbol.") : null,
      el("div", { class: "gl-term-head" }, el("span", { class: "gl-term-name", text: term.term })),
      el("div", { class: "gl-def", text: term.definition }));
    if (term.source) {
      const title = papers ? papers.find(paper => paper.id === term.source!.paperId)?.title
        : paperTitle(ctx.data.papers, term.source.paperId);
      const label = `${title ?? term.source.paperId}${term.source.page === undefined ? "" : `, p. ${term.source.page}`}`;
      const source = overviewAction(label, () => ctx.end.post({ type: "openPaper", paperId: term.source!.paperId }));
      source.classList.add("gl-src-link"); source.title = label;
      body.append(el("div", { class: "gl-src" }, source, papers && !title ? el("span", { text: "Not in your Library" }) : null));
    }
    body.append(el("div", { class: "gl-actions" }, overviewAction("Edit", () => edit(term), ctx.readOnly),
      overviewAction("Delete", () => remove(term), ctx.readOnly)));
    list.append(el("li", { class: `gl-term${conflict ? " conflict" : ""}` }, el("div", { class: "gl-term-not", text: term.symbol ?? "" }), body));
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
