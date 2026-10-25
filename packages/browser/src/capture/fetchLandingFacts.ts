/** Reads an article's landing page from the extension's background, with the user's cookies, bounded in time. */
import { fetchLanding, type ILogger, type PageFacts } from "@labshelf/core";

const LANDING_TIMEOUT_MS = 12_000;

/** @returns the page's facts, or undefined when it cannot be fetched or is not HTML (a bot wall, a PDF, a timeout) */
export function fetchLandingFacts(log: ILogger, url: string): Promise<PageFacts | undefined> {
  return fetchLanding(url, { fetch, timeoutMs: LANDING_TIMEOUT_MS, credentials: "include", logger: log });
}
