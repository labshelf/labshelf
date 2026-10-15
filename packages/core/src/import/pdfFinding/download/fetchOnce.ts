/** Makes one download attempt: proves a response is the PDF by its bytes, or hands back the HTML to follow, or reports a bot check. */
import { startTimeout } from "../timeout.js";
import { warn } from "../env.js";
import type { FetchedPdf, PdfFetchOptions, ResolverEnv } from "../types.js";
import { isBotCheck } from "./botCheck.js";
import { isPdfBytes } from "./pdfBytes.js";

const MAX_PDF_BYTES = 200 * 1024 * 1024;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 45_000;

export interface FetchAnswer {
  finalUrl: string;
  pdf?: FetchedPdf;
  html?: string;
  blocked?: boolean;
}

type RequestSettings = Pick<PdfFetchOptions, "credentials" | "headers">;

/** @returns the answer, or undefined when the URL gave nothing usable (an HTTP error, a network error, a timeout) */
export async function fetchOnce(url: string, env: ResolverEnv, settings: RequestSettings): Promise<FetchAnswer | undefined> {
  const timer = startTimeout(TIMEOUT_MS);
  try {
    const res = await env.fetch(url, {
      redirect: "follow",
      signal: timer.signal,
      ...(settings.credentials ? { credentials: settings.credentials } : {}),
      ...(settings.headers ? { headers: settings.headers } : {}),
    });
    const finalUrl = res.url || url;
    if (!res.ok || res.status === 202) {
      const text = await res.text().catch(() => "");
      return isBotCheck(res.status, text) ? { finalUrl, blocked: true } : undefined;
    }
    if (Number(res.headers.get("content-length") ?? "0") > MAX_PDF_BYTES) return undefined;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_PDF_BYTES) return undefined;
    if (isPdfBytes(bytes)) return { finalUrl, pdf: { bytes, url: finalUrl } };
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (bytes.length <= MAX_HTML_BYTES && (type.includes("html") || type === "")) {
      return { finalUrl, html: new TextDecoder().decode(bytes) };
    }
    return { finalUrl };
  } catch (error) {
    warn(env, "download failed", { url, error: error instanceof Error ? error.message : String(error) });
    return undefined;
  } finally {
    timer.stop();
  }
}
