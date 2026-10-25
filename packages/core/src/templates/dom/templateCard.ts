// Renders one template as a card: thumbnail or placeholder, name, by-line and meta line.
import { icon } from "../../ui/index.js";
import { el } from "../../ui/dom/index.js";
import type { TemplateEntry } from "../templateEntry.js";
import { templateByLine, templateMetaLine, templateUsesLabel } from "../templateLabels.js";

/** Fills a thumbnail box with the image, or with the placeholder icon when there is none. */
export function fillThumb(box: HTMLElement, dataUri: string | undefined, alt: string): void {
  if (dataUri === undefined) {
    box.replaceChildren(el("span", { class: "ls-tpl-thumb-icon", html: icon("file-text") }));
    return;
  }
  box.replaceChildren(el("img", { src: dataUri, alt, loading: "lazy" }));
}

export interface TemplateCard {
  item: HTMLLIElement;
  button: HTMLButtonElement;
  setThumbnail(dataUri: string | undefined): void;
}

export function renderTemplateCard(entry: TemplateEntry, thumbnail: string | undefined): TemplateCard {
  const by = templateByLine(entry);
  const thumb = el("div", { class: "ls-tpl-thumb" });
  const button = el("button", { class: "ls-tpl-card", type: "button", "aria-label": entry.name, tabindex: -1 },
    thumb,
    el("div", { class: "ls-tpl-card-body" },
      el("div", { class: "ls-tpl-card-name", text: entry.name, title: entry.name }),
      el("div", { class: "ls-tpl-card-by", text: by, title: by }),
      el("div", { class: "ls-tpl-card-meta", text: [templateMetaLine(entry), templateUsesLabel(entry)].filter((part) => part !== undefined).join(" · ") })));
  const setThumbnail = (dataUri: string | undefined): void => fillThumb(thumb, dataUri, "");
  setThumbnail(thumbnail);
  return { item: el("li", {}, button), button, setThumbnail };
}
