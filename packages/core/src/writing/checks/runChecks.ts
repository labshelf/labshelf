/** Runs every pre-submission rule over a built PDF and its project's sources. */
// CONTRACT: documents/contracts/library-format.md#labshelfyaml
import type { CheckSettings } from "../project/index.js";
import { deriveAnonymityProblems } from "./anonymityRules.js";
import type { CheckProblem, CheckSource, PdfFacts } from "./checkReport.js";
import { derivePaperBody } from "./derivePaperBody.js";
import { deriveImageResolutionProblems, derivePageLimitProblems, deriveType3FontProblems, deriveUnresolvedReferenceProblems } from "./pdfRules.js";

export interface CheckInput {
  facts: PdfFacts;
  sources: CheckSource[];
  /** The project's `check:` key; without it every rule but the page limit runs. */
  settings: CheckSettings | undefined;
  /** The git user's name, which an anonymous paper must not show either. */
  gitUser: string | undefined;
}

/** Errors first, then in PDF order, so the worst problems lead the list. */
export function runChecks({ facts, sources, settings, gitUser }: CheckInput): CheckProblem[] {
  const body = derivePaperBody(facts.pages.map((page) => page.lines));
  const names = [...(settings?.authors ?? []), ...(gitUser === undefined ? [] : [gitUser])];
  const findings = [
    ...derivePageLimitProblems(body, facts.pages.length, settings),
    ...(settings?.anonymous ?? true ? deriveAnonymityProblems({ facts, body, names, sources }) : []),
    ...deriveUnresolvedReferenceProblems(facts),
    ...deriveType3FontProblems(facts),
    ...deriveImageResolutionProblems(facts),
  ];
  const rank = (finding: CheckProblem): number => (finding.severity === "error" ? 0 : 1);
  return findings.map((finding, order) => ({ finding, order })).sort((a, b) => rank(a.finding) - rank(b.finding) || a.order - b.order).map(({ finding }) => finding);
}
