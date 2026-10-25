// Extracts the author address that PubMed appends to an affiliation as "Electronic address: x@y.z.".
import { normalizeEmail } from "./authorEmail.js";

/** @returns the first "Electronic address:" in PubMed affiliation text, or undefined when none is valid */
export function extractEmailFromAffiliation(text: string): string | undefined {
  for (const m of text.matchAll(/Electronic\s+address\s*:\s*([^\s;,<>]+)/gi)) {
    const email = normalizeEmail(m[1]);
    if (email) return email;
  }
  return undefined;
}
