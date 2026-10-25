/** Words what `install` did for each listed paper, and the one message that closes it, the same in every app. */
import type { ImportOutcome } from "../../library/index.js";
import type { PaperRecord } from "../../model/index.js";
import type { InstallEntry } from "./planInstall.js";

/** A planned entry and, for an `import` entry, what its import returned. */
export interface InstallResult {
  entry: InstallEntry;
  outcome?: ImportOutcome | undefined;
}

export interface InstallLine {
  level: "info" | "warn";
  text: string;
}

/** @returns the line for one paper, starting with its listed key */
export function describeInstall({ entry, outcome }: InstallResult): InstallLine {
  const { key } = entry;
  switch (entry.kind) {
    case "present": return { level: "info", text: `${key}: already in the library` };
    case "other-key": return { level: "warn", text: `${key}: in the library as ${entry.existingKey}; cite it by that key or rename the paper` };
    case "no-doi": return { level: "warn", text: `${key}: no DOI listed, cannot install` };
    case "bad-key": return { level: "warn", text: `${key}: not usable as a cite key (letters, digits and _ . + - only), cannot install` };
    case "import": break;
  }
  if (!outcome || outcome.status === "skipped") { return { level: "warn", text: `${key}: not installed` }; }
  if (outcome.status === "failed") { return { level: "warn", text: `${key}: failed: ${outcome.error}` }; }
  if (outcome.status === "duplicate") { return { level: "warn", text: `${key}: in the library as ${outcome.existingId}; cite it by that key or rename the paper` }; }
  const { record } = outcome;
  if (record.citeKey !== key) { return { level: "warn", text: `${key}: added as ${record.citeKey} because ${key} was taken` }; }
  return record.hasPdf
    ? { level: "info", text: `${key}: added` }
    : { level: "warn", text: `${key}: added without a PDF` };
}

const addedRecords = (results: readonly InstallResult[]): PaperRecord[] =>
  results.flatMap(({ outcome }) => (outcome?.status === "added" ? [outcome.record] : []));

/** The listed key resolves to a library paper once the install is done. */
export function keyResolves({ entry, outcome }: InstallResult): boolean {
  return entry.kind === "present" || (entry.kind === "import" && outcome?.status === "added" && outcome.record.citeKey === entry.key);
}

/** @returns the closing message; warn when a listed key does not resolve or a paper has no PDF */
export function summarizeInstall(results: readonly InstallResult[]): InstallLine {
  if (!results.length) { return { level: "info", text: "The project lists no papers" }; }
  const added = addedRecords(results);
  const withoutPdf = added.filter((record) => !record.hasPdf).length;
  const unresolved = results.filter((result) => !keyResolves(result)).length;
  const parts = [`${added.length} added`, `${results.filter(({ entry }) => entry.kind === "present").length} already in the library`];
  if (withoutPdf) { parts.push(`${withoutPdf} without a PDF`); }
  if (unresolved) { parts.push(`${unresolved} not resolved`); }
  return { level: withoutPdf || unresolved ? "warn" : "info", text: parts.join(", ") };
}
