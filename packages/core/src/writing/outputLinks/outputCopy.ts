/** What a linked output puts in the project: the copy derived from the source file (as is, a rendered table, or the kept values), the text inserted into a manuscript, and the states of a link with their sentences. */
// CONTRACT: documents/contracts/library-format.md#linked-outputs
import { baseName } from "../../path/index.js";
import { deriveOutputValuePrefix, deriveProjectValueLeaves } from "../project/index.js";
import type { OutputFormat, OutputKind, OutputLink } from "./outputsFile.js";
import { parseOutputTable, renderOutputTable } from "./outputTables.js";

export const IMAGE_OUTPUT_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"];
/** Files a figure shows: images, PDF and EPS. */
export const FIGURE_OUTPUT_EXTENSIONS = [...IMAGE_OUTPUT_EXTENSIONS, ".pdf", ".eps"];
export const TABLE_OUTPUT_EXTENSIONS = [".csv", ".tsv", ".json"];
/** The source files the Link output dialog offers. */
export const LINKABLE_OUTPUT_EXTENSIONS = [...FIGURE_OUTPUT_EXTENSIONS, ".csv", ".tsv", ".json", ".tex", ".typ", ".txt"];

// --- Values ---

/** The dotted keys of every leaf of a JSON file, in document order. */
export function listOutputValueKeys(json: unknown): string[] {
  return deriveProjectValueLeaves("", json, "").leaves.map((leaf) => leaf.path);
}

/** The leaves of `json` at `keys`, nested again (`{"test": {"acc": 0.9}}`); a key that is absent or not a leaf is listed in `missing`. */
export function filterOutputValues(json: unknown, keys: readonly string[]): { values: Record<string, unknown>; missing: string[] } {
  const leaves = new Map(deriveProjectValueLeaves("", json, "").leaves.map((leaf) => [leaf.path, leaf.value]));
  const values: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const key of keys) {
    if (!leaves.has(key)) { missing.push(key); continue; }
    const parts = key.split(".");
    let node = values;
    for (const part of parts.slice(0, -1)) { node = (node[part] ??= {}) as Record<string, unknown>; }
    node[parts.at(-1)!] = leaves.get(key);
  }
  return { values, missing };
}

/** The `\lsvalue` key of a kept value: `<source>.<path without extension, "/" as ".">.<key>`. */
export const deriveOutputValueKey = (link: Pick<OutputLink, "source" | "path">, key: string): string => `${deriveOutputValuePrefix(link.source, link.path)}.${key}`;

// --- The copy ---

export interface OutputCopyOptions { source: string; path: string; decimals?: number; keys?: readonly string[] }

/** The copy's bytes from the source file's bytes; `missing` lists the kept keys the file no longer has. Throws a sentence when the file cannot be read as its kind. */
export function deriveOutputCopy(kind: OutputKind, bytes: Uint8Array, options: OutputCopyOptions, format: OutputFormat): { bytes: Uint8Array; missing: string[] } {
  if (kind === "file") { return { bytes, missing: [] }; }
  const text = new TextDecoder("utf-8").decode(bytes);
  if (kind === "table") {
    const table = parseOutputTable(options.path, text);
    return { bytes: new TextEncoder().encode(renderOutputTable(table, options, format)), missing: [] };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${options.path} is not valid JSON.`);
  }
  const { values, missing } = filterOutputValues(json, options.keys ?? []);
  return { bytes: new TextEncoder().encode(`${JSON.stringify(values, null, 2)}\n`), missing };
}

// --- States ---

export type OutputState = "unlinked" | "fresh" | "stale" | "missing";

export interface OutputLinkStatus {
  state: OutputState;
  /** The copy is not in the project: nothing to preview; Update or Run writes it. */
  copyMissing: boolean;
  /** Why the source could not be read here, as a sentence; the state is `unlinked` then. */
  error?: string;
  /** The kept keys the source file no longer has. */
  missingKeys?: string[];
}

/** The state from the recorded hash and what the source gives now: undefined when not linked here, "absent" when the file is not there. */
export function deriveOutputState(link: Pick<OutputLink, "hash">, current: { hash: string; missing: readonly string[] } | "absent" | undefined, copyMissing: boolean): OutputLinkStatus {
  if (current === undefined) { return { state: "unlinked", copyMissing }; }
  if (current === "absent") { return { state: "missing", copyMissing }; }
  if (current.missing.length > 0) { return { state: "missing", copyMissing, missingKeys: [...current.missing] }; }
  return { state: current.hash === link.hash && !copyMissing ? "fresh" : "stale", copyMissing };
}

/** The hover's sentence for a link's state. */
export function describeOutputState(link: Pick<OutputLink, "source" | "path">, status: OutputLinkStatus): string {
  const name = baseName(link.path);
  const copy = status.copyMissing ? " The copy is not in the project yet." : "";
  if (status.error !== undefined) { return `${status.error}${copy}`; }
  switch (status.state) {
    case "unlinked": return `${link.source} is not linked to code on this computer.${copy}`;
    case "fresh": return "Up to date with the source.";
    case "stale": return status.copyMissing ? `The copy is not in the project yet; Update writes it from ${name}.` : `${name} changed since this copy; Update copies it again.`;
    case "missing": return status.missingKeys?.length
      ? `${name} has no ${status.missingKeys.join(", ")}: not generated yet — Run.${copy}`
      : `${name} is not generated yet — Run.${copy}`;
  }
}
