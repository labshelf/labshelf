/** Reads a tab's page for the capture flow, with the URL alone as the fallback for a tab the probe cannot enter. */
import type { RawPage } from "@labshelf/core";
import { BrowserLogger } from "../platform";
import { probe } from "./pageProbeContentScript";
import { scriptingApi } from "./tab";

const log = new BrowserLogger("capture");

// A tab the probe cannot enter (the browser's own PDF viewer on some versions) is still usable when its URL is a PDF.
export async function probeTab(tabId: number, tabUrl: string): Promise<RawPage> {
  const scripting = scriptingApi();
  try {
    if (!scripting) throw new Error("scripting API unavailable");
    const results = (await scripting.executeScript({ target: { tabId }, func: probe })) as Array<{ result?: RawPage }>;
    const raw = results[0]?.result;
    if (raw) return raw;
    throw new Error("probe returned nothing");
  } catch (err) {
    void log.warn("probe failed, using the URL alone", { url: tabUrl, error: err instanceof Error ? err.message : String(err) });
    const pageIsPdf = /\.pdf(?:[?#]|$)/i.test(tabUrl);
    return { pageUrl: tabUrl, meta: {}, pdfLinks: [], doiLinks: [], ...(pageIsPdf ? { pageIsPdf: true } : {}) };
  }
}
