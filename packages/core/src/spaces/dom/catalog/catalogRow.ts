// Builds a Space catalog row with navigation to its overview or papers.
import { formatDay } from "../../../library/index.js";
import { el, icon, memberChip, progressMark } from "../../../ui/dom/index.js";
import type { SpacesTransport, SpaceTab } from "../../protocol/index.js";
import type { CatalogRow } from "../../view/index.js";

function countLink(count: number, noun: string, open: () => void): HTMLButtonElement {
  const link = el("button", { type: "button", text: `${count} ${noun}${count === 1 ? "" : "s"}` });
  link.addEventListener("click", (event) => { event.stopPropagation(); open(); });
  return link;
}

export function catalogRow(row: CatalogRow, end: SpacesTransport): HTMLElement {
  const article = el("article", { class: "catalog-row" });
  if (row.unreadable !== undefined) {
    article.append(el("div", { class: "catalog-main" },
      el("strong", { text: row.name }),
      el("p", { text: `spaces/${row.id}/space.json` }), el("p", { text: row.unreadable })));
    return article;
  }
  const open = (tab: SpaceTab): void => end.post({ type: "openSpace", id: row.id, tab });
  const title = el("button", { class: "catalog-title", type: "button", title: row.name },
    el("span", { "aria-hidden": "true", html: icon("layers") }), el("span", { text: row.name }));
  title.addEventListener("click", (event) => { event.stopPropagation(); open("overview"); });
  article.addEventListener("click", () => open("overview"));
  article.append(el("div", { class: "catalog-main" }, title,
    el("p", { text: row.purpose ?? "A personal place to read, collect ideas and explore." }),
    el("div", { class: "catalog-links" },
      countLink(row.counts.papers, "paper", () => open("papers")),
      countLink(row.counts.projects, "project", () => open("overview")))),
  el("div", { class: "catalog-reading", "aria-label": "Reading progress" }, progressMark(row.reading.done, row.reading.total),
    el("span", { text: `${row.reading.done} / ${row.reading.total} Done` })),
  el("div", { class: "catalog-next" }, row.next
    ? el("time", { datetime: row.next.date, title: row.next.date, text: formatDay(row.next.date) }) : el("span", { text: "No upcoming dates" }),
    row.next ? el("span", { text: row.next.title }) : null),
  el("div", { class: "catalog-members" }, el("span", { text: "Personal" }), el("div", {}, memberChip("You"))));
  return article;
}
