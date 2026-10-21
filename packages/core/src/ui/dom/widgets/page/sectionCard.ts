// Builds a titled card section with an actions slot beside the heading and a body below.
import { el } from "../../dom.js";

export interface SectionCardOptions {
  title: string;
  actions?: HTMLElement[];
  body: Node;
}

let nextId = 0;

export function sectionCard(opts: SectionCardOptions): HTMLElement {
  const id = `ls-card-title-${++nextId}`;
  const head = el("div", { class: "ls-card-head" }, el("h2", { id, text: opts.title }),
    opts.actions?.length ? el("div", { class: "ls-card-actions" }, ...opts.actions) : null);
  return el("section", { class: "ls-card", "aria-labelledby": id }, head, opts.body);
}
