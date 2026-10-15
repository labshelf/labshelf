/** Makes one download attempt: proves a response is the PDF by its bytes, or hands back the HTML to follow, or reports a bot check. */
import { isPdfBytes } from "../../../library/index.js";
import { warn } from "../env.js";
import type { FetchedPdf, FetchOutcome, PdfFetchOptions, ResolverEnv } from "../types.js";
import { classifyFetch } from "./fetchOutcome.js";
import { errorMessage } from "../../../logging/index.js";

const MAX_PDF_BYTES = 200 * 1024 * 1024;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 45_000;

export interface FetchAnswer {
  finalUrl: string;
  outcome: FetchOutcome;
  /** Absent when the request failed before any response. */
  status?: number;
  pdf?: FetchedPdf;
  html?: string;
}

type RequestSettings = Pick<PdfFetchOptions, "credentials" | "headers">;

/** @returns what the URL answered and how that answer classifies; an `error` outcome for a network failure or an unusable response */
export async function fetchOnce(url: string, env: ResolverEnv, settings: RequestSettings): Promise<FetchAnswer> {
  try {
    const res = await env.fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(settings.credentials ? { credentials: settings.credentials } : {}),
      ...(settings.headers ? { headers: settings.headers } : {}),
    });
    const finalUrl = res.url || url;
    const { status } = res;
    if (!res.ok || status === 202) {
      const html = await res.text().catch(() => "");
      return { finalUrl, status, outcome: classifyFetch({ status, finalUrl, html }) };
    }
    if (Number(res.headers.get("content-length") ?? "0") > MAX_PDF_BYTES) return { finalUrl, status, outcome: "error" };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_PDF_BYTES) return { finalUrl, status, outcome: "error" };
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    const isHtml = !isPdfBytes(bytes) && bytes.length <= MAX_HTML_BYTES && (type.includes("html") || type === "");
    const html = isHtml ? new TextDecoder().decode(bytes) : undefined;
    const outcome = classifyFetch({ status, finalUrl, bytes, ...(html !== undefined ? { html } : {}) });
    return {
      finalUrl, status, outcome,
      ...(outcome === "pdf" ? { pdf: { bytes, url: finalUrl } } : {}),
      ...(html !== undefined ? { html } : {}),
    };
  } catch (error) {
    warn(env, "download failed", { url, error: errorMessage(error) });
    return { finalUrl: url, outcome: "error" };
  }
}
