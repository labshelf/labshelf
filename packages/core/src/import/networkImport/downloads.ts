/** Downloads what a user-typed URL serves: the bytes with their content type and final URL, and whether they are a web page. */
import type { NetworkImportEnv } from "./env.js";

export interface Downloaded {
  bytes: Uint8Array;
  contentType: string;
  /** The URL after redirects; relative links on the page resolve against it. */
  finalUrl: string;
}

const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;
const HTML_SNIFF_BYTES = 1024;

/** @throws when the request fails or the file is larger than the cap */
export async function fetchBytes(env: NetworkImportEnv, url: string): Promise<Downloaded> {
  const { fetch: doFetch, headers } = env.download;
  const response = await doFetch(url, { redirect: "follow", ...(headers ? { headers } : {}) });
  if (!response.ok) { throw new Error(`Download failed: HTTP ${response.status}`); }
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_DOWNLOAD_BYTES) { throw new Error("The file is too large"); }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "",
    finalUrl: response.url || url,
  };
}

/** Servers mislabel pages, so the body counts as well as the content type. */
export function isHtml({ bytes, contentType }: Downloaded): boolean {
  if (/html/i.test(contentType)) { return true; }
  return /^\s*(<!doctype html|<html)/i.test(new TextDecoder().decode(bytes.slice(0, HTML_SNIFF_BYTES)));
}
