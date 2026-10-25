// Fetches a walled PDF from inside a background tab that loads the walled URL and passes its check, then closes the tab.
// The tab is inactive so the user's focus and the popup stay put.
import { formatError, fetchPdf, isWallPage, extractNextHopsFromHtml, type FetchedPdf, type ILogger } from "@labshelf/core";
import { bx } from "../../platform";
import { scriptingApi } from "./scripting";
import { fetchInTab } from "./tabFetch";

const SETTLE_TIMEOUT_MS = 15_000;
const POLL_MS = 600;
// Enough of the rendered page to hold a wall's markers; a wall page is small, a real page shows none near the top.
const MAX_PAGE_CHARS = 300_000;

/**
 * Loads `urls[0]` in a background tab, waits until the page has passed its bot check, and downloads from it the first
 * of `urls` on that site that is a PDF. Aborting `signal` stops the wait and closes the tab.
 * @returns The PDF, or undefined when the site still refuses.
 */
export async function fetchViaHelperTab(log: ILogger, urls: string[], signal: AbortSignal): Promise<FetchedPdf | undefined> {
  const [walled] = urls;
  const origin = originOf(walled);
  if (!walled || !origin) return undefined;
  // The walled URL itself, not the site's root: PMC's proof-of-work only guards the paths it answers on.
  const tab = await bx.tabs.create({ url: walled, active: false });
  if (tab.id === undefined) return undefined;
  const tabId = tab.id;
  try {
    if (!(await settled(tabId, signal))) {
      if (!signal.aborted) void log.log("WARN", "capture", "Helper tab did not pass the check", { url: walled });
      return undefined;
    }
    for (const url of urls.filter((u) => originOf(u) === origin)) {
      if (signal.aborted) return undefined;
      const pdf = await fetchFromTab(log, tabId, origin, url);
      if (pdf) return pdf;
    }
    return undefined;
  } finally {
    await bx.tabs.remove(tabId).catch((error: unknown) =>
      log.log("WARN", "capture", "Helper tab did not close", { tabId, message: formatError(error) }),
    );
  }
}

async function fetchFromTab(log: ILogger, tabId: number, origin: string, url: string): Promise<FetchedPdf | undefined> {
  const answer = await fetchInTab(tabId, url);
  if (answer?.pdf) return answer.pdf;
  // PLATFORM: Firefox runs no extension script in its PDF viewer, so a tab showing the PDF cannot fetch it; the
  // clearance the tab earned lets a background fetch through instead.
  if (!answer) return fetchPdf(url, { credentials: "include", logger: log });
  // An interstitial: its target (often a signed CDN link) usually downloads from the background; otherwise try it
  // from the tab too.
  for (const hop of answer.html ? extractNextHopsFromHtml(answer.html, answer.finalUrl) : []) {
    const pdf = (await fetchPdf(hop, { credentials: "include", logger: log })) ?? (originOf(hop) === origin ? (await fetchInTab(tabId, hop))?.pdf : undefined);
    if (pdf) return pdf;
  }
  return undefined;
}

function originOf(url: string | undefined): string | undefined {
  try { return url ? new URL(url).origin : undefined; } catch { return undefined; }
}

// Waits until the tab shows a PDF or a real page — not a bot check, not the blank document a challenge passes through
// while it reloads — on two polls in a row.
async function settled(tabId: number, signal: AbortSignal): Promise<boolean> {
  const scripting = scriptingApi();
  if (!scripting) return false;
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let calm = 0;
  while (Date.now() < deadline && !signal.aborted) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    try {
      const [first] = (await scripting.executeScript({ target: { tabId }, func: pageState, args: [MAX_PAGE_CHARS] })) as Array<{ result?: PageState }>;
      const page = first?.result;
      calm = page && (page.pdf || (page.ready && !isWallPage(page.html, page.url))) ? calm + 1 : 0;
    } catch {
      // Not injectable: still navigating, or a page no extension may script (Firefox's PDF viewer) once it is loaded.
      const tab = await bx.tabs.get(tabId).catch(() => undefined);
      if (!tab) return false;
      calm = tab.status === "complete" ? calm + 1 : 0;
    }
    if (calm >= 2) return true;
  }
  return false;
}

interface PageState {
  ready: boolean;
  pdf: boolean;
  url: string;
  html: string;
}

// Runs in the tab (serialized): must not reference anything outside itself.
function pageState(maxChars: number): PageState {
  return {
    ready: document.readyState === "complete" && document.title.trim() !== "",
    pdf: document.contentType === "application/pdf",
    url: location.href,
    html: document.documentElement.outerHTML.slice(0, maxChars),
  };
}
