// Renders one template as a card: thumbnail or placeholder, name, by-line and meta line.
import { renderIcon } from "../../ui/index.js";
import { renderElement } from "../../ui/dom/index.js";
import type { TemplateEntry } from "../templateEntry.js";
import { formatTemplateByLine, formatTemplateMetaLine, formatTemplateUsesLabel } from "../templateLabels.js";

/** Fills a thumbnail box with the image, or with the placeholder icon when there is none. */
export function updateThumbnailBox(box: HTMLElement, dataUri: string | undefined, alt: string): void {
  if (dataUri === undefined) {
    box.replaceChildren(renderElement("span", { class: "ls-tpl-thumb-icon", html: renderIcon("file-text") }));
    return;
  }
  box.replaceChildren(renderElement("img", { src: dataUri, alt, loading: "lazy" }));
}

export interface TemplateCard {
  item: HTMLLIElement;
  button: HTMLButtonElement;
  setThumbnail(dataUri: string | undefined): void;
}

export function renderTemplateCard(entry: TemplateEntry, thumbnail: string | undefined): TemplateCard {
  const by = formatTemplateByLine(entry);
  const thumb = renderElement("div", { class: "ls-tpl-thumb" });
  const button = renderElement("button", { class: "ls-tpl-card", type: "button", "aria-label": entry.name, tabindex: -1 },
    thumb,
    renderElement("div", { class: "ls-tpl-card-body" },
      renderElement("div", { class: "ls-tpl-card-name", text: entry.name, title: entry.name }),
      renderElement("div", { class: "ls-tpl-card-by", text: by, title: by }),
      renderElement("div", { class: "ls-tpl-card-meta", text: [formatTemplateMetaLine(entry), formatTemplateUsesLabel(entry)].filter((part) => part !== undefined).join(" · ") })));
  const setThumbnail = (dataUri: string | undefined): void => updateThumbnailBox(thumb, dataUri, "");
  setThumbnail(thumbnail);
  return { item: renderElement("li", {}, button), button, setThumbnail };
}
