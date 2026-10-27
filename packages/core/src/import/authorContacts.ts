// Finds the people a reader can write to about a paper: validates addresses, reads them from page evidence and PubMed affiliations, and falls back from the article page to PubMed.
import { formatError } from "../errors/index.js";
import { fetchPubmedAuthorsByDoi, type RegistryEnv } from "./registries/index.js";
import { parseHtmlPage, type RawPage } from "./htmlPage.js";

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

const PUBLISHER_MAILBOX =
  /^(?:[^@]*(?:permissions?|support|no-?reply)|rights|info|help|helpdesk|contact|admin|webmaster|editors?|editorial|journals?|donotreply|customer[-.]?(?:service|care)|production|publisher|press|office|service|services|subscriptions?|reprints?|licensing|copyright|feedback|privacy|library|sales)(?:[._+-].*)?@/i;

/** @returns the trimmed address when it is well formed, otherwise undefined */
function normalizeEmail(raw: string | undefined): string | undefined {
  const email = raw?.trim().replace(/\.+$/, "");
  return email && EMAIL.test(email) ? email : undefined;
}

/** True for a mailbox a publisher runs (permissions@, support@, editorial office), which is never the author. */
function isPublisherMailbox(email: string): boolean {
  return PUBLISHER_MAILBOX.test(email);
}

/** @returns the addresses of one mailto: href, without query string, percent-decoded and validated */
function parseMailtoAddresses(href: string): string[] {
  const body = href.replace(/^mailto:/i, "").split(/[?#]/)[0] ?? "";
  let decoded = body;
  try {
    decoded = decodeURIComponent(body);
  } catch {
    // A malformed escape leaves the raw text, which the address check then rejects or accepts as it stands.
  }
  return decoded.split(/[,;]/).map(normalizeEmail).filter((e): e is string => !!e);
}

/** @returns the first "Electronic address:" in PubMed affiliation text, or undefined when none is valid */
export function extractEmailFromAffiliation(text: string): string | undefined {
  for (const m of text.matchAll(/Electronic\s+address\s*:\s*([^\s;,<>]+)/gi)) {
    const email = normalizeEmail(m[1]);
    if (email) return email;
  }
  return undefined;
}

export interface AuthorContact {
  email: string;
  /** "Given Family" or "Family, Given", as the page printed it; set only when a meta tag named the author. */
  name?: string;
}

const CORRESPONDENCE = /correspond|[*⁎]\s*(?:e-?mail|contact)/i;

/** @returns de-duplicated contacts: explicit meta tags first, then mailto links that sit beside correspondence wording */
export function deriveAuthorContacts(raw: RawPage): AuthorContact[] {
  const contacts = new Map<string, AuthorContact>();
  const add = (email: string, name?: string): void => {
    const key = email.toLowerCase();
    const known = contacts.get(key);
    if (!known) contacts.set(key, name ? { email, name } : { email });
    else if (name && !known.name) known.name = name;
  };
  for (const meta of raw.authorEmails) {
    const email = normalizeEmail(meta.email);
    if (email) add(email, meta.name);
  }
  for (const link of raw.mailtoLinks) {
    if (!CORRESPONDENCE.test(link.context)) continue;
    for (const email of parseMailtoAddresses(link.href)) if (!isPublisherMailbox(email)) add(email);
  }
  return [...contacts.values()];
}

const MODULE = "authorContacts";
const PAGE_TIMEOUT_MS = 12_000;

export interface AuthorContactsInput {
  /** The article page; its addresses are read from `page` when the host already probed it. */
  articleUrl?: string;
  page?: RawPage;
  doi?: string;
}

/** `env.fetch` carries the host's session (cookies), because many article pages show the correspondence block only to readers who are signed in. */
export async function findAuthorContacts(lookup: AuthorContactsInput, env: RegistryEnv): Promise<AuthorContact[]> {
  const page = lookup.page ?? (lookup.articleUrl ? await fetchPage(lookup.articleUrl, env) : undefined);
  const fromPage = page ? deriveAuthorContacts(page) : [];
  if (fromPage.length || !lookup.doi) return fromPage;
  const authors = await fetchPubmedAuthorsByDoi(env, lookup.doi);
  const fromPubMed = authors.flatMap(({ name, affiliations }) => {
    const email = affiliations.map(extractEmailFromAffiliation).find((e) => e !== undefined);
    return email ? [{ email, ...(name ? { name } : {}) }] : [];
  });
  await env.logger?.log("INFO", MODULE, "author contacts", { page: lookup.articleUrl ?? null, fromPage: 0, fromPubMed: fromPubMed.length });
  return fromPubMed;
}

async function fetchPage(url: string, env: RegistryEnv): Promise<RawPage | undefined> {
  const doFetch = env.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  try {
    const response = await doFetch(url, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
    if (!response.ok) {
      await env.logger?.log("WARN", MODULE, "article page unavailable", { url, status: response.status });
      return undefined;
    }
    return parseHtmlPage(await response.text(), response.url || url);
  } catch (error) {
    await env.logger?.log("WARN", MODULE, "article page unavailable", { url, message: formatError(error) });
    return undefined;
  }
}
