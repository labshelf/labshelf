// Shapes a built citation map for the library UI, naming only the library papers a link or a missing work mentions.
import type { CitationMap } from "../../import/index.js";
import type { PaperRecord } from "../../model/index.js";
import type { CitationMapView } from "../protocol/index.js";

export function createCitationMapView(map: CitationMap, papers: ReadonlyArray<Pick<PaperRecord, "id" | "title">>): CitationMapView {
  const mentioned = new Set<string>([
    ...map.links.flatMap((link) => [link.from, link.to]),
    ...map.missing.flatMap((work) => work.citedBy),
  ]);
  return {
    papers: papers.filter((paper) => mentioned.has(paper.id)).map(({ id, title }) => ({ id, title })),
    links: map.links,
    missing: map.missing,
  };
}
