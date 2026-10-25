/** Reads a tab's page for the capture flow, with the URL alone as the fallback for a tab the probe cannot enter. */
import { formatError, type ILogger, type RawPage } from "@labshelf/core";
import { readPageAnchors, readPageMeta, type PageLinkEvidence, type PageMetaEvidence } from "./pageProbe";
import { readScriptingApi } from "./tab";

// A tab the probe cannot enter (the browser's own PDF viewer on some versions) is still usable when its URL is a PDF.
export async function readTabPage(log: ILogger, tabId: number, tabUrl: string): Promise<RawPage> {
  const scripting = readScriptingApi();
  try {
    if (!scripting) throw new Error("scripting API unavailable");
    const target = { tabId };
    const [metaRun, linksRun] = await Promise.all([
      scripting.executeScript({ target, func: readPageMeta }) as Promise<Array<{ result?: PageMetaEvidence }>>,
      scripting.executeScript({ target, func: readPageAnchors }) as Promise<Array<{ result?: PageLinkEvidence }>>,
    ]);
    const meta = metaRun[0]?.result;
    const links = linksRun[0]?.result;
    if (meta && links) return { ...meta, ...links };
    throw new Error("probe returned nothing");
  } catch (err) {
    void log.log("WARN", "capture", "probe failed, using the URL alone", { url: tabUrl, error: formatError(err) });
    const pageIsPdf = /\.pdf(?:[?#]|$)/i.test(tabUrl);
    return { pageUrl: tabUrl, meta: {}, pdfLinks: [], doiLinks: [], mailtoLinks: [], authorEmails: [], ...(pageIsPdf ? { pageIsPdf: true } : {}) };
  }
}
