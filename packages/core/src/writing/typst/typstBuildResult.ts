// Describes the outcome of compiling a Typst project: the PDF and citation placements on success, the problems on failure.
import type { LocatedProblem } from "../latex/build/index.js";
import type { TypstCite } from "../review/index.js";

export type TypstBuildResult =
  /** `cites` is empty when the citation probe failed; the failure is logged. */
  | { status: "succeeded"; pdf: string; problems: LocatedProblem[]; cites: TypstCite[] }
  | { status: "failed"; problems: LocatedProblem[] };
