// Builds a titled card section with an actions slot beside the heading and a body below.
import { renderElement } from "../../dom.js";
import { renderIcon, type IconName } from "../../../icons/index.js";

export interface SectionCardOptions {
  title: string;
  icon?: IconName;
  actions?: HTMLElement[];
  body: Node;
}

let nextId = 0;

export function renderSectionCard(opts: SectionCardOptions): HTMLElement {
  const id = `ls-card-title-${++nextId}`;
  const head = renderElement("div", { class: "ls-card-head" },
    opts.icon ? renderElement("span", { class: "ls-card-icon", "aria-hidden": "true", html: renderIcon(opts.icon) }) : null, renderElement("h2", { id, text: opts.title }),
    opts.actions?.length ? renderElement("div", { class: "ls-card-actions" }, ...opts.actions) : null);
  return renderElement("section", { class: "ls-card", "aria-labelledby": id }, head, opts.body);
}
