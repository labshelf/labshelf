// Keeps the Glossary surface synchronized while preserving unfinished dialogs.
import { el, emptyState, positioned } from "../../../ui/dom/index.js";
import type { GlossaryTerm } from "../../model/index.js";
import type { PaperPickItem } from "../../protocol/index.js";
import { overviewAction, type OverviewContext, type SpaceBody } from "../overview/index.js";
import { deleteTerm } from "./deleteTerm.js";
import { termDialog } from "./termDialog.js";
import { termList } from "./termList.js";

export function mountSpaceGlossary(root: HTMLElement, initial: OverviewContext): SpaceBody {
  let controller = new AbortController();
  const ctx = { ...initial, readOnly: locked(initial), signal: controller.signal };
  let papers: readonly PaperPickItem[] | undefined;
  let closeDialog: (() => void) | undefined;
  const edit = (term?: GlossaryTerm): void => { closeDialog?.(); closeDialog = termDialog(ctx, term); };
  const remove = (term: GlossaryTerm): void => { closeDialog?.(); closeDialog = deleteTerm(ctx, term); };
  const render = (): void => {
    const main = el("section", { class: "gl-main", "aria-label": "Glossary" },
      el("div", { class: "gl-bar" }, el("h2", { text: "Glossary" }), overviewAction("Add term", () => edit(), ctx.readOnly)));
    const reason = ctx.data.readOnlyReason ?? ctx.data.glossary.readOnlyReason;
    if (reason) main.append(el("p", { role: "status", text: reason }));
    main.append(ctx.data.glossary.terms.length ? termList(ctx, edit, remove, papers)
      : emptyState({ text: "No terms yet.", hint: "Select a term in a paper to add it." }));
    root.replaceChildren(el("div", { class: "gl-grid" }, main, plannedColumn()));
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
  const suggest = overviewAction("Find suggestions", () => {});
  positioned(suggest, "Suggestions need paper text extraction");
  const generate = overviewAction("Generate labshelf-glossary.tex", () => {});
  positioned(generate, "Glossary file generation needs a connected writing project");
  return el("aside", { class: "gl-side", "aria-label": "Glossary tools" },
    el("h2", { class: "gl-side-title", text: "Suggested" }),
    emptyState({ text: "No suggestions yet.", hint: "Suggestions appear here for review.", inline: true }), suggest,
    generate, el("p", { class: "gl-gen-hint", text: "Generate macros and a list of symbols for a writing project." }));
}
