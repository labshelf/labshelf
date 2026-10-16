// Builds the head of a single-entry citation card: tag, byline, title, venue, key and the citing command.
import type { CitationBibEntry, CitationCardPaper, CitationEntry } from "../../../../index.js";
import { STATUS_LABEL } from "../../../../../model/index.js";
import { arcMarkElement, el } from "../../../../../ui/dom/index.js";
import { STATUS_ARC } from "../../../../../ui/icons/index.js";

/** Authors and year on one line; either may be missing. */
export function byline(record: Pick<CitationBibEntry, "authors" | "year">): string {
  return [record.authors.join(", "), record.year === undefined ? "" : String(record.year)].filter(Boolean).join(" · ");
}

function venueLine(entry: CitationEntry): string {
  const folder = entry.paper?.folder;
  return [entry.paper?.venue ?? entry.bib?.venue, folder].filter(Boolean).join(" · ");
}

/** The tag says where the key was found: REF for a library paper, BIB for a record only in the `.bib` file. */
function tag(entry: CitationEntry): HTMLElement | null {
  if (entry.paper) { return el("span", { class: "rd-cite-tag", text: "REF" }); }
  return entry.bib ? el("span", { class: "rd-cite-tag", text: "BIB" }) : null;
}

export function citationHead(entry: CitationEntry): HTMLElement {
  const record: CitationCardPaper | CitationBibEntry | undefined = entry.paper ?? entry.bib;
  const title = record?.title ?? entry.key;
  const status = entry.paper?.status;
  const { site } = entry;
  const venue = venueLine(entry);
  return el("div", { class: "rd-cite-head" },
    status && arcMarkElement(...STATUS_ARC[status], STATUS_LABEL[status]),
    el("div", { class: "rd-cite-head-text" },
      el("div", { class: "rd-cite-top" },
        record && byline(record) && el("p", { class: "rd-cite-byline" }, byline(record)),
        tag(entry),
      ),
      el("p", { class: "rd-cite-title" }, title),
      venue && el("p", { class: "rd-cite-venue" }, venue),
      el("code", { class: "rd-cite-key" }, entry.key),
      site && el("p", { class: "rd-cite-site" }, `${site.file}:${site.line} · ${site.text}`),
    ),
  );
}
