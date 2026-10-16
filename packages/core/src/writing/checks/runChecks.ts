/** Runs every pre-submission rule over a built PDF and its project's sources. */
// CONTRACT: documents/contracts/library-format.md#labshelfyaml
import type { CheckSettings } from "../project/index.js";
import { anonymityFindings } from "./anonymityRules.js";
import type { CheckFinding, CheckSource, PdfFacts } from "./checkTypes.js";
import { paperBody } from "./paperBody.js";
import { imageResolutionFindings, pageLimitFindings, type3FontFindings, unresolvedReferenceFindings } from "./pdfRules.js";

export interface CheckInput {
  facts: PdfFacts;
  sources: CheckSource[];
  /** The project's `check:` key; without it every rule but the page limit runs. */
  settings: CheckSettings | undefined;
  /** The git user's name, which an anonymous paper must not show either. */
  gitUser: string | undefined;
}

/** Errors first, then in PDF order, so the worst problems lead the list. */
export function runChecks({ facts, sources, settings, gitUser }: CheckInput): CheckFinding[] {
  const body = paperBody(facts.pages.map((page) => page.lines));
  const names = [...(settings?.authors ?? []), ...(gitUser === undefined ? [] : [gitUser])];
  const findings = [
    ...pageLimitFindings(body, facts.pages.length, settings),
    ...(settings?.anonymous ?? true ? anonymityFindings({ facts, body, names, sources }) : []),
    ...unresolvedReferenceFindings(facts),
    ...type3FontFindings(facts),
    ...imageResolutionFindings(facts),
  ];
  const rank = (finding: CheckFinding): number => (finding.severity === "error" ? 0 : 1);
  return findings.map((finding, order) => ({ finding, order })).sort((a, b) => rank(a.finding) - rank(b.finding) || a.order - b.order).map(({ finding }) => finding);
}
