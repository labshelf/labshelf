// Classifies one fetch hop as a PDF, a bot check, a login or paywall, a plain HTML page or an error.
import { isPdfBytes } from "../../../library/index.js";
import type { FetchOutcome } from "../pdfResolver.js";
import { isBotCheck } from "./botCheck.js";
import type { HeaderReader } from "./signatures.js";
import { nextHopsFromHtml } from "./hops.js";

/** What a hop came back with; `html` is the decoded body of an HTML or non-OK answer. */
export interface FetchFacts {
  status: number;
  finalUrl: string;
  /** Start of the body when it was read as a download. */
  bytes?: Uint8Array;
  html?: string;
  /** The response headers, for the walls that announce themselves there. */
  headers?: HeaderReader;
}

const PASSWORD_FIELD = /<input\b[^>]*\btype\s*=\s*["']?password/i;
const LOGIN_WORDS = /sign in|log ?in,? or register|log in via an institution|access through your institution|purchase|get access/i;

/** True for a page that asks for credentials or payment instead of showing the article. */
function isLoginWall(html: string): boolean {
  const markup = html.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, "");
  return PASSWORD_FIELD.test(markup) || LOGIN_WORDS.test(markup.replace(/<[^>]*>/g, " "));
}

export function classifyFetch({ status, finalUrl, bytes, html, headers }: FetchFacts): FetchOutcome {
  if (bytes && isPdfBytes(bytes)) return "pdf";
  if (isBotCheck(status, html ?? "", { finalUrl, ...(headers ? { headers } : {}) })) return "bot";
  if (status === 401 || status === 403) return "login";
  if (status < 200 || status >= 300 || html === undefined) return "error";
  // A page that still offers a PDF or a redirect is a hop to follow, whatever else it says.
  if (nextHopsFromHtml(html, finalUrl).length) return "html";
  return isLoginWall(html) ? "login" : "html";
}
