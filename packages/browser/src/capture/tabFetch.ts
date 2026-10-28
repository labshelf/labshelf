// Runs code inside tabs through the scripting API: fetching a URL as the page would, and loading a walled PDF through a helper tab.
import { sleep, formatError, fetchPdf, originOf, isWallPage, extractNextHopsFromHtml, base64ToBytes, isPdfBytes, type FetchedPdf, type ILogger, type InTabAnswer } from "@labshelf/core";
import { bx } from "../platform";

/** Finds the browser's scripting API on whichever global exposes it. */
// PLATFORM: webextension-polyfill omits the scripting API.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readScriptingApi(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).chrome?.scripting ?? (globalThis as any).browser?.scripting;
}

/*
 * Fetches a URL from inside a tab: same origin, same cookies, same bot clearance as the page the user is looking at.
 * The bytes come back base64-encoded because script results must be JSON.
 */
const MAX_HTML_BYTES = 4 * 1024 * 1024;

interface InTabResult {
  b64?: string;
  html?: string;
  url: string;
}

/** @returns the PDF or the HTML answer, or undefined when the tab cannot be scripted or the URL gave neither */
export async function fetchInTab(tabId: number, url: string): Promise<InTabAnswer | undefined> {
  const scripting = readScriptingApi();
  if (!scripting) return undefined;
  try {
    const results = (await scripting.executeScript({
      target: { tabId },
      func: inTabFetch,
      args: [url, MAX_HTML_BYTES],
    })) as Array<{ result?: InTabResult | null }>;
    const result = results[0]?.result;
    if (!result) return undefined;
    if (result.html !== undefined) return { finalUrl: result.url, html: result.html };
    if (!result.b64) return undefined;
    const bytes = base64ToBytes(result.b64);
    return isPdfBytes(bytes) ? { finalUrl: result.url, pdf: { bytes, url: result.url } } : undefined;
  } catch {
    // A tab that cannot be scripted (a browser page, a closed tab) is no source; the caller moves on.
    return undefined;
  }
}

// TRAP: runs in the tab (serialized), so it must not reference anything outside itself, core's base64 included.
async function inTabFetch(url: string, maxHtml: number): Promise<InTabResult | null> {
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const finalUrl = res.url || url;
    const head = String.fromCharCode(...bytes.subarray(0, 1024));
    if (!head.includes("%PDF-")) {
      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      return type.includes("html") && bytes.length <= maxHtml ? { html: new TextDecoder().decode(bytes), url: finalUrl } : null;
    }
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { b64: btoa(binary), url: finalUrl };
  } catch {
    return null;
  }
}

// Fetches a walled PDF from inside a background tab that loads the walled URL and passes its check, then closes the tab.
// The tab is inactive so the user's focus and the popup stay put.
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

// Waits until the tab shows a PDF or a real page — not a bot check, not the blank document a challenge passes through
// while it reloads — on two polls in a row.
async function settled(tabId: number, signal: AbortSignal): Promise<boolean> {
  const scripting = readScriptingApi();
  if (!scripting) return false;
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let calm = 0;
  while (Date.now() < deadline && !signal.aborted) {
    await sleep(POLL_MS);
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
