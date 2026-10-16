// Asks a paper's authors for a copy: finds their address, opens the request email in the user's mail client and
// records the day on the paper. Without an address it opens the article page, where the user can look further.
import { findAuthorContacts, requestCopyMailto, type ILogger, type PaperRecord, type RawPage } from "@labshelf/core";
import { bx, getSettings, type AskAuthorData } from "../../platform";
import { listAllRecords, type LibraryMutations } from "../../storage";
import { broadcastChanged } from "../broadcast";

const MODULE = "askAuthor";
// Several addresses are usually co-corresponding authors; more than this reads as a mass mailing.
const MAX_RECIPIENTS = 3;

export interface AskAuthorDeps {
  log: ILogger;
  mutations: LibraryMutations;
  scheduleSync: (reason: string) => void;
}

export interface AskAuthorSource {
  /**
   * The tab the email opens in, so no empty tab is left behind.
   * PLATFORM: a tab navigated to mailto: hands off to the mail client and keeps its page. Tests cannot cover it.
   */
  tabId?: number | undefined;
  /** The article page as the capture probed it, so its addresses are read without fetching it again. */
  page?: RawPage | undefined;
  articleUrl?: string | undefined;
}

export async function askAuthor(deps: AskAuthorDeps, paper: PaperRecord, source: AskAuthorSource = {}): Promise<AskAuthorData> {
  const settings = await getSettings();
  const articleUrl = source.articleUrl || paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : undefined);
  const contacts = await findAuthorContacts(
    { ...(articleUrl ? { articleUrl } : {}), ...(source.page ? { page: source.page } : {}), ...(paper.doi ? { doi: paper.doi } : {}) },
    { fetch: (input, init) => fetch(input, { ...init, credentials: "include" }), logger: deps.log, contactEmail: settings.contactEmail },
  );
  if (contacts.length === 0) {
    void deps.log.log("INFO", MODULE, "no author address found", { paperId: paper.id, page: articleUrl ?? null });
    if (!articleUrl || !/^https?:\/\//i.test(articleUrl)) return { id: paper.id, opened: "none" };
    await bx.tabs.create({ url: articleUrl });
    return { id: paper.id, opened: "article" };
  }
  const mailto = requestCopyMailto({
    to: contacts.slice(0, MAX_RECIPIENTS).map((c) => c.email),
    paper,
    requester: { name: settings.requesterName, affiliation: settings.requesterAffiliation },
    lang: settings.requestLanguage,
  });
  if (source.tabId !== undefined) await bx.tabs.update(source.tabId, { url: mailto });
  else await bx.tabs.create({ url: mailto });
  // INVARIANT: the day is the user's local calendar day, as the detail pane shows it; "en-CA" formats it as YYYY-MM-DD.
  const day = new Date().toLocaleDateString("en-CA");
  await deps.mutations.setPdfRequestedAt(paper, day);
  deps.scheduleSync(MODULE);
  broadcastChanged(MODULE, paper.id);
  void deps.log.log("INFO", MODULE, "request email opened", { paperId: paper.id, recipients: Math.min(contacts.length, MAX_RECIPIENTS), lang: settings.requestLanguage });
  return { id: paper.id, opened: "mail" };
}

/** Library page "Ask the author" on a saved paper; the email opens in the library's own tab. */
export async function handleAskAuthor(deps: AskAuthorDeps, id: string, tabId: number | undefined): Promise<AskAuthorData> {
  const record = (await listAllRecords()).find((r) => r.id === id);
  if (!record) throw new Error("This paper is no longer in your library.");
  return askAuthor(deps, record, { tabId });
}
