/**
 * Fetches a URL from inside a tab: same origin, same cookies, same bot clearance as the page the user is looking at.
 * The bytes come back base64-encoded because script results must be JSON.
 */
import { base64ToBytes, isPdfBytes } from "@labshelf/core";
import type { InTabAnswer } from "@labshelf/core";
import { readScriptingApi } from "./scripting";

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
