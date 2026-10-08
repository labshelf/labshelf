/** Downloads for imports: bytes with their content type and final URL, and PDFs proven by their magic bytes. */

export interface Downloaded {
  bytes: Uint8Array;
  contentType: string;
  /** The URL after redirects; relative links on the page resolve against it. */
  finalUrl: string;
}

const PDF_MAGIC = "%PDF-";
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;
const HTML_SNIFF_BYTES = 1024;

/** @throws when the request fails or the file is larger than the cap */
export async function fetchBytes(doFetch: typeof fetch, url: string): Promise<Downloaded> {
  const response = await doFetch(url, { redirect: "follow", headers: { "User-Agent": "LabShelf-Terminal/0.1" } });
  if (!response.ok) { throw new Error(`Download failed: HTTP ${response.status}`); }
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_DOWNLOAD_BYTES) { throw new Error("The file is too large"); }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "",
    finalUrl: response.url || url,
  };
}

export function isPdf(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.slice(0, PDF_MAGIC.length)) === PDF_MAGIC;
}

/** Servers mislabel pages, so the body counts as well as the content type. */
export function isHtml({ bytes, contentType }: Downloaded): boolean {
  if (/html/i.test(contentType)) { return true; }
  return /^\s*(<!doctype html|<html)/i.test(new TextDecoder().decode(bytes.slice(0, HTML_SNIFF_BYTES)));
}

/** @throws when the URL does not serve a PDF, so an HTML page is never saved as paper.pdf */
export async function downloadPdf(doFetch: typeof fetch, url: string): Promise<Uint8Array> {
  const { bytes } = await fetchBytes(doFetch, url);
  if (!isPdf(bytes)) { throw new Error("The URL did not return a PDF"); }
  return bytes;
}
