/** Fetches an article's landing page and reads it for citation tags and PDF links. */
import type { ILogger } from "../../ports/index.js";
import { parseHtmlPage } from "./htmlPage.js";
import { interpretPage } from "./pageFacts.js";
import type { PageFacts } from "./types.js";
import { errorMessage } from "../../logging/index.js";

const LANDING_MODULE = "landing";

export interface LandingFetchOptions {
  fetch: typeof fetch;
  timeoutMs: number;
  /** Sends the user's cookies when "include", so a page behind an institutional login reads like the tab. */
  credentials?: "include" | "omit" | "same-origin";
  headers?: Record<string, string>;
  logger?: ILogger;
}

/**
 * Callers treat a page they cannot read (a bot wall, a PDF, a timeout) as "no landing page", so failures yield
 * undefined instead of throwing.
 * @returns the page's facts, or undefined when it cannot be fetched or is not HTML
 */
export async function fetchLandingPage(url: string, options: LandingFetchOptions): Promise<PageFacts | undefined> {
  // A bare reference: a browser's fetch throws "Illegal invocation" when called as a method of another object.
  const doFetch = options.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const res = await doFetch(url, {
      redirect: "follow",
      signal: controller.signal,
      ...(options.credentials ? { credentials: options.credentials } : {}),
      ...(options.headers ? { headers: options.headers } : {}),
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return undefined;
    return interpretPage(parseHtmlPage(await res.text(), res.url || url));
  } catch (error) {
    // A page that cannot be read is routine, so the failure is a warning that names the url.
    await options.logger?.log("WARN", LANDING_MODULE, "Landing page fetch failed", { url, message: errorMessage(error) });
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
