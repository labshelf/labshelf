/** Reads an article's landing page from the extension's background, with the user's cookies, bounded in time. */
import { fetchLandingPage } from "@labshelf/core";
import type { PageFacts } from "@labshelf/core";

const LANDING_TIMEOUT_MS = 12_000;

/** @returns the page's facts, or undefined when it cannot be fetched or is not HTML (a bot wall, a PDF, a timeout) */
export function landingFacts(url: string): Promise<PageFacts | undefined> {
  return fetchLandingPage(url, { fetch, timeoutMs: LANDING_TIMEOUT_MS, credentials: "include" });
}
