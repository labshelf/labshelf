// Finds addresses to ask a paper's authors for a copy: the article page first, then PubMed's affiliation lines.
import { formatError } from "../../../errors/index.js";
import { fetchPubmedAuthorsByDoi, type RegistryEnv } from "../../registries/index.js";
import { parseHtmlPage } from "../htmlPage.js";
import type { RawPage } from "../rawPage.js";
import { deriveAuthorContacts, type AuthorContact } from "./deriveAuthorContacts.js";
import { extractEmailFromAffiliation } from "./affiliation.js";

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
