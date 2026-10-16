/** Makes one download attempt: proves a response is the PDF by its bytes, or hands back the HTML to follow, or reports a bot check. */
import { isPdfBytes } from "../../../library/index.js";
import { warn } from "../env.js";
import type { FetchedPdf, FetchOutcome, PdfFetchOptions, ResolverEnv } from "../types.js";
import { classifyFetch } from "./fetchOutcome.js";
import { errorMessage } from "../../../logging/index.js";

const MAX_PDF_BYTES = 200 * 1024 * 1024;
const MAX_HTML_BYTES = 4 * 1024 * 1024;

export interface FetchAnswer {
  finalUrl: string;
  outcome: FetchOutcome;
  /** Absent when the request failed before any response. */
  status?: number;
  pdf?: FetchedPdf;
  html?: string;
}

/** How one candidate's hops are sent: its deadline, the wait for response headers, and the article page as Referer. */
export interface HopSettings {
  signal: AbortSignal;
  firstByteMs: number;
  referer?: string;
}

type RequestSettings = Pick<PdfFetchOptions, "credentials" | "headers"> & HopSettings;

/** @returns what the URL answered and how that answer classifies; an `error` outcome for a network failure or an unusable response */
export async function fetchOnce(url: string, env: ResolverEnv, settings: RequestSettings): Promise<FetchAnswer> {
  const firstByte = new AbortController();
  const timer = setTimeout(() => firstByte.abort(new DOMException("No response headers in time", "TimeoutError")), settings.firstByteMs);
  try {
    const res = await env.fetch(url, {
      redirect: "follow",
      signal: AbortSignal.any([settings.signal, firstByte.signal]),
      ...(settings.credentials ? { credentials: settings.credentials } : {}),
      ...requestHeaders(settings),
    });
    clearTimeout(timer);
    const finalUrl = res.url || url;
    const { status } = res;
    if (!res.ok || status === 202) {
      const html = await res.text().catch(() => "");
      return { finalUrl, status, outcome: classifyFetch({ status, finalUrl, html, headers: res.headers }) };
    }
    if (Number(res.headers.get("content-length") ?? "0") > MAX_PDF_BYTES) return { finalUrl, status, outcome: "error" };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_PDF_BYTES) return { finalUrl, status, outcome: "error" };
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    const isHtml = !isPdfBytes(bytes) && bytes.length <= MAX_HTML_BYTES && (type.includes("html") || type === "");
    const html = isHtml ? new TextDecoder().decode(bytes) : undefined;
    const outcome = classifyFetch({ status, finalUrl, bytes, headers: res.headers, ...(html !== undefined ? { html } : {}) });
    return {
      finalUrl, status, outcome,
      ...(outcome === "pdf" ? { pdf: { bytes, url: finalUrl } } : {}),
      ...(html !== undefined ? { html } : {}),
    };
  } catch (error) {
    // A download the run cancelled because another one won is not a failure worth a line.
    if ((error as { name?: unknown } | null)?.name !== "AbortError") warn(env, "download failed", { url, error: errorMessage(error) });
    return { finalUrl: url, outcome: "error" };
  } finally {
    clearTimeout(timer);
  }
}

// PLATFORM: browsers drop a Referer header set through fetch (a forbidden header name); Node sends it.
function requestHeaders({ headers, referer }: RequestSettings): { headers?: Record<string, string> } {
  if (!referer) return headers ? { headers } : {};
  return { headers: { ...headers, Referer: referer } };
}
