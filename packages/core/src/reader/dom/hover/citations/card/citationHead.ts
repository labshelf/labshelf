// Builds the head of a single-entry citation card: tag, byline, title, venue and the citing command.
import type { CitationBibEntry, CitationCardPaper, CitationEntry } from "../../../../index.js";
import { renderElement } from "../../../../../ui/dom/index.js";

/** Authors and year on one line; either may be missing. */
export function byline(record: Pick<CitationBibEntry, "authors" | "year">): string {
  return [record.authors.join(", "), record.year === undefined ? "" : String(record.year)].filter(Boolean).join(" · ");
}

/** The first author's surname and "et al." for several authors; either part may be missing. */
function shortByline(record: Pick<CitationBibEntry, "authors" | "year">): string {
  const [first] = record.authors;
  const lead = record.authors.length > 1 && first ? `${first.trim().split(/\s+/).pop()} et al.` : record.authors.join(", ");
  return [lead, record.year === undefined ? "" : String(record.year)].filter(Boolean).join(" · ");
}

function venueLine(entry: CitationEntry): string {
  const folder = entry.paper?.folder?.split("/").join(" › ");
  return [entry.paper?.venue ?? entry.bib?.venue, folder].filter(Boolean).join(" · ");
}

/** The tag says where the key was found: REF for a library paper, BIB for a record only in the `.bib` file. */
function tag(entry: CitationEntry): HTMLElement | null {
  if (entry.paper) { return renderElement("span", { class: "rd-cite-tag", text: "REF" }); }
  return entry.bib ? renderElement("span", { class: "rd-cite-tag", text: "BIB" }) : null;
}

export function citationHead(entry: CitationEntry): HTMLElement {
  const record: CitationCardPaper | CitationBibEntry | undefined = entry.paper ?? entry.bib;
  const title = record?.title ?? entry.key;
  const { site } = entry;
  const venue = venueLine(entry);
  const names = record && shortByline(record);
  return renderElement("div", { class: "rd-cite-head" },
    renderElement("div", { class: "rd-cite-head-text" },
      renderElement("div", { class: "rd-cite-top" },
        names && renderElement("p", { class: "rd-cite-byline" }, names),
        tag(entry),
      ),
      renderElement("p", { class: "rd-cite-title" }, title),
      venue && renderElement("p", { class: "rd-cite-venue" }, venue),
      site && renderElement("p", { class: "rd-cite-site" }, `${site.file}:${site.line} · ${site.text}`),
    ),
  );
}
