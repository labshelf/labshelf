/** Imports what a person typed to add a paper from the network: an identifier, a link that names one, or a link to a PDF or an article page. */
import type { ImportOutcome } from "../../library/index.js";
import { identifiersFromInput } from "../identifiers/index.js";
import type { NetworkImportEnv } from "./env.js";
import { importIdentifier, type IdentifierImportOptions } from "./importIdentifier.js";
import { importUrl } from "./importUrl.js";

/** A link that names an identifier (arxiv.org/abs/…, a DOI link) is imported through the registries, not downloaded. */
function isDirectUrl(input: string): boolean {
  return /^https?:\/\//i.test(input) && identifiersFromInput(input).length === 0;
}

/** @returns what happened; `options.citeKey` applies to identifiers only (a link to a PDF or page is keyed by its metadata) */
export function importNetworkInput(
  env: NetworkImportEnv,
  input: string,
  targetDir: string,
  options: IdentifierImportOptions = {},
): Promise<ImportOutcome> {
  return isDirectUrl(input) ? importUrl(env, input, targetDir) : importIdentifier(env, input, targetDir, options);
}
