/** Writes the Typst source that reports where a document's citations land, and reads its answer. */
import type { TypstCite } from "../writing/review/index.js";

/** Where a build's citations landed, or why that is not known. */
export type TypstCitations = { cites: TypstCite[] } | { failure: string };

// TRAP: the compiler only shadows this path in memory; a project file with the same name would be hidden for the probe compile.
export const PROBE_FILE = "__labshelf_citations__.typ";
export const PROBE_LABEL = "labshelf-citations";

const typstString = (text: string): string => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * The probe includes the main file and appends invisible metadata, so the citations it reports sit where the main's own compile
 * puts them; `mainFromRoot` starts with `/`, which Typst resolves against the project root.
 */
export function citationProbeSource(mainFromRoot: string): string {
  return [
    `#include ${typstString(mainFromRoot)}`,
    "#context [#metadata(query(cite).map(c => {",
    "  let at = c.location().position()",
    "  (key: str(c.key), page: at.page, x: at.x.pt(), y: at.y.pt())",
    `})) <${PROBE_LABEL}>]`,
    "",
  ].join("\n");
}

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function toCite(item: unknown): TypstCite | undefined {
  if (typeof item !== "object" || item === null) { return undefined; }
  const { key, page, x, y } = item as Record<string, unknown>;
  if (typeof key !== "string" || !isFiniteNumber(page) || !Number.isInteger(page) || !isFiniteNumber(x) || !isFiniteNumber(y)) { return undefined; }
  return { key, at: { page, x, y } };
}

/** Reads the query result for the probe's label: one metadata value holding every citation. */
export function readProbeAnswer(answer: unknown): TypstCitations {
  if (!Array.isArray(answer) || answer.length !== 1 || !Array.isArray(answer[0])) {
    return { failure: `Unexpected citation query result: ${JSON.stringify(answer)?.slice(0, 200)}` };
  }
  const cites = (answer[0] as unknown[]).map(toCite);
  return cites.every((cite) => cite !== undefined)
    ? { cites: cites as TypstCite[] }
    : { failure: "A citation in the query result has no key or position." };
}
