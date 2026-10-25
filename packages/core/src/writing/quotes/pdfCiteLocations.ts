/** Reads which cite key a link of a compiled PDF stands for: a hyperref destination name, or a Typst citation's position. */
import type { PageArea, PagePoint } from "../../reader/index.js";

/** Where a Typst build placed one citation: its key and the top-left of its text. */
export interface TypstCitation {
  key: string;
  at: PagePoint;
}

// hyperref names the target of `\cite{key}` `cite.key`; biblatex adds the refsection, `cite.0@key`.
const HYPERREF_CITE = /^cite\.(?:\d+@)?(.+)$/;

/** The cite key of a hyperref destination name, or `undefined` for a destination that is not a citation. */
export function deriveCiteKey(dest: string): string | undefined {
  return HYPERREF_CITE.exec(dest)?.[1];
}

// Positions and link rectangles come from the same layout but through different rounding.
const SLACK = 1;

/** The key of the Typst citation whose text starts inside the area, e.g. the rectangle of a link. */
export function findTypstCitationAt(cites: readonly TypstCitation[], area: PageArea): string | undefined {
  const inside = (cite: TypstCitation): boolean =>
    cite.at.page === area.page
    && cite.at.x >= area.left - SLACK && cite.at.x <= area.right + SLACK
    && cite.at.y >= area.top - SLACK && cite.at.y <= area.bottom + SLACK;
  return cites.find(inside)?.key;
}
