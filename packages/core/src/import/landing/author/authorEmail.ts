// Validates and normalises e-mail addresses read from pages, and rejects publisher mailboxes that are not an author.

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

const PUBLISHER_MAILBOX =
  /^(?:[^@]*(?:permissions?|support|no-?reply)|rights|info|help|helpdesk|contact|admin|webmaster|editors?|editorial|journals?|donotreply|customer[-.]?(?:service|care)|production|publisher|press|office|service|services|subscriptions?|reprints?|licensing|copyright|feedback|privacy|library|sales)(?:[._+-].*)?@/i;

/** @returns the trimmed address when it is well formed, otherwise undefined */
export function normalizeEmail(raw: string | undefined): string | undefined {
  const email = raw?.trim().replace(/\.+$/, "");
  return email && EMAIL.test(email) ? email : undefined;
}

/** True for a mailbox a publisher runs (permissions@, support@, editorial office), which is never the author. */
export function isPublisherMailbox(email: string): boolean {
  return PUBLISHER_MAILBOX.test(email);
}

/** @returns the addresses of one mailto: href, without query string, percent-decoded and validated */
export function parseMailtoAddresses(href: string): string[] {
  const body = href.replace(/^mailto:/i, "").split(/[?#]/)[0] ?? "";
  let decoded = body;
  try {
    decoded = decodeURIComponent(body);
  } catch {
    // A malformed escape leaves the raw text, which the address check then rejects or accepts as it stands.
  }
  return decoded.split(/[,;]/).map(normalizeEmail).filter((e): e is string => !!e);
}
