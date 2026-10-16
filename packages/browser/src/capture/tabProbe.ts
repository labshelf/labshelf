/** Reads a tab's page for the capture flow, with the URL alone as the fallback for a tab the probe cannot enter. */
import { errorMessage, type ILogger, type RawPage } from "@labshelf/core";
import { probe } from "./pageProbeContentScript";
import { scriptingApi } from "./tab";

// A tab the probe cannot enter (the browser's own PDF viewer on some versions) is still usable when its URL is a PDF.
export async function probeTab(log: ILogger, tabId: number, tabUrl: string): Promise<RawPage> {
  const scripting = scriptingApi();
  try {
    if (!scripting) throw new Error("scripting API unavailable");
    const results = (await scripting.executeScript({ target: { tabId }, func: probe })) as Array<{ result?: RawPage }>;
    const raw = results[0]?.result;
    if (raw) return raw;
    throw new Error("probe returned nothing");
  } catch (err) {
    void log.log("WARN", "capture", "probe failed, using the URL alone", { url: tabUrl, error: errorMessage(err) });
    const pageIsPdf = /\.pdf(?:[?#]|$)/i.test(tabUrl);
    return { pageUrl: tabUrl, meta: {}, pdfLinks: [], doiLinks: [], mailtoLinks: [], authorEmails: [], ...(pageIsPdf ? { pageIsPdf: true } : {}) };
  }
}
