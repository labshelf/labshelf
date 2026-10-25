// Renders the share page's top bar: the folder name, Install LabShelf, Open in LabShelf, Download, and the rights notice.
import { formatShareImportUri, type ShareLinkParts } from "@labshelf/core";
import { renderElement, renderIcon, showMenu, type MenuEntry } from "@labshelf/core/dom";

const INSTALL_URL = "../#s1-1";
const RIGHTS_NOTICE = "The person who shared this folder is responsible for the right to share these papers.";

export interface TopBarOptions {
  /** Absent until the share is open, and when it cannot be. */
  folder?: string;
  link?: ShareLinkParts;
  /** Shows Back to folder, on a paper. */
  back?: () => void;
  /** The Download menu, built when it opens. */
  downloads?: () => MenuEntry[];
}

const labelled = (glyph: Parameters<typeof renderIcon>[0], text: string): string => `${renderIcon(glyph)}<span>${text}</span>`;

export function renderTopBar(bar: HTMLElement, { folder, link, back, downloads }: TopBarOptions): void {
  const backButton = back ? renderElement("button", { class: "ls-btn ls-btn-ghost", type: "button", html: labelled("arrow-left", "Back to folder") }) : null;
  backButton?.addEventListener("click", back!);
  const download = downloads
    ? renderElement("button", { class: "ls-btn", type: "button", "aria-haspopup": "menu", html: `${labelled("download", "Download")}${renderIcon("chevron-down")}` })
    : null;
  download?.addEventListener("click", () => showMenu(download, downloads!()));
  const actions = renderElement("div", { class: "share-bar-actions" },
    renderElement("a", { class: "ls-btn ls-btn-ghost", href: INSTALL_URL, html: labelled("external", "Install LabShelf") }),
    link ? renderElement("a", { class: "ls-btn ls-btn-primary", href: formatShareImportUri(link), title: "Copy these papers into your LabShelf library in VS Code", html: labelled("book-open", "Open in LabShelf") }) : null,
    download);
  const title = folder
    ? renderElement("div", { class: "share-bar-folder" }, renderElement("span", { html: renderIcon("folder") }), renderElement("strong", { text: folder }))
    : null;
  const notice = renderElement("p", { class: "share-bar-notice", text: RIGHTS_NOTICE });
  bar.replaceChildren(
    renderElement("div", { class: "share-bar-row" },
      backButton,
      title,
      renderElement("span", { class: "ls-brand share-bar-brand", html: `${renderIcon("logo")}<span>Shared with LabShelf</span>` }),
      renderElement("span", { class: "share-bar-spacer" }),
      actions),
    ...(folder ? [notice] : []));
}
