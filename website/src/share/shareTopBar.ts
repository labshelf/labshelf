// Renders the share page's top bar: the folder name, Install LabShelf, Open in LabShelf, Download, and the rights notice.
import { formatShareLink, type ShareLinkParts } from "@labshelf/core";
import { el, icon, showMenu, type MenuEntry } from "@labshelf/core/dom";

// CONTRACT: documents/contracts/share-link.md#open-in-labshelf
function importUri(link: ShareLinkParts): string {
  return `vscode://labshelf.labshelf/importShare?link=${encodeURIComponent(formatShareLink(link))}`;
}

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

const labelled = (glyph: Parameters<typeof icon>[0], text: string): string => `${icon(glyph)}<span>${text}</span>`;

export function renderTopBar(bar: HTMLElement, { folder, link, back, downloads }: TopBarOptions): void {
  const backButton = back ? el("button", { class: "ls-btn ls-btn-ghost", type: "button", html: labelled("arrow-left", "Back to folder") }) : null;
  backButton?.addEventListener("click", back!);
  const download = downloads
    ? el("button", { class: "ls-btn", type: "button", "aria-haspopup": "menu", html: `${labelled("download", "Download")}${icon("chevron-down")}` })
    : null;
  download?.addEventListener("click", () => showMenu(download, downloads!()));
  const actions = el("div", { class: "share-bar-actions" },
    el("a", { class: "ls-btn ls-btn-ghost", href: INSTALL_URL, html: labelled("external", "Install LabShelf") }),
    link ? el("a", { class: "ls-btn ls-btn-primary", href: importUri(link), title: "Copy these papers into your LabShelf library in VS Code", html: labelled("book-open", "Open in LabShelf") }) : null,
    download);
  const title = folder
    ? el("div", { class: "share-bar-folder" }, el("span", { html: icon("folder") }), el("strong", { text: folder }))
    : null;
  const notice = el("p", { class: "share-bar-notice", text: RIGHTS_NOTICE });
  bar.replaceChildren(
    el("div", { class: "share-bar-row" },
      backButton,
      title,
      el("span", { class: "ls-brand share-bar-brand", html: `${icon("logo")}<span>Shared with LabShelf</span>` }),
      el("span", { class: "share-bar-spacer" }),
      actions),
    ...(folder ? [notice] : []));
}
