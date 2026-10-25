// Lists the people a reader can write to about a paper, from author e-mail meta tags and correspondence mailto links.
import { addressesOfMailto, isPublisherMailbox, validEmail } from "./authorEmail.js";
import type { RawPage } from "../rawPage.js";

export interface AuthorContact {
  email: string;
  /** "Given Family" or "Family, Given", as the page printed it; set only when a meta tag named the author. */
  name?: string;
}

const CORRESPONDENCE = /correspond|[*⁎]\s*(?:e-?mail|contact)/i;

/** @returns de-duplicated contacts: explicit meta tags first, then mailto links that sit beside correspondence wording */
export function authorContacts(raw: RawPage): AuthorContact[] {
  const contacts = new Map<string, AuthorContact>();
  const add = (email: string, name?: string): void => {
    const key = email.toLowerCase();
    const known = contacts.get(key);
    if (!known) contacts.set(key, name ? { email, name } : { email });
    else if (name && !known.name) known.name = name;
  };
  for (const meta of raw.authorEmails) {
    const email = validEmail(meta.email);
    if (email) add(email, meta.name);
  }
  for (const link of raw.mailtoLinks) {
    if (!CORRESPONDENCE.test(link.context)) continue;
    for (const email of addressesOfMailto(link.href)) if (!isPublisherMailbox(email)) add(email);
  }
  return [...contacts.values()];
}
