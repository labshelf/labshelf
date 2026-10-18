/**
 * Validates untrusted messages from the reader and the links a PDF asks the host to open.
 */
import { checkPreviewRequest, type PreviewRequest } from "../previewRequests.js";
import type { WebviewToHost } from "./webviewToHost.js";

export const MAX_CITE_QUOTE_LENGTH = 2000;

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function isCiteInProject(m: Record<string, unknown>): boolean {
  const { paperId, page, quote } = m;
  return isStr(paperId) && paperId.length > 0
    && (page === undefined || (Number.isInteger(page) && (page as number) >= 1))
    && (quote === undefined || (isStr(quote) && quote.length <= MAX_CITE_QUOTE_LENGTH));
}

/**
 * Validates an untrusted webview message against the protocol; anything malformed is rejected so host handlers never see partial payloads.
 * @returns true when `raw` is a well-formed WebviewToHost message.
 */
export function isWebviewMessage(raw: unknown): raw is WebviewToHost {
  if (!isObj(raw) || !isStr(raw["command"])) { return false; }
  const m = raw;
  const preview = checkPreviewRequest(m);
  if (preview !== null) { return preview; }
  switch (m["command"] as Exclude<WebviewToHost, PreviewRequest>["command"]) {
    case "ready-for-init":
      return true;
    case "ready":
      return isNum(m["totalPages"]);
    case "perf":
      return isObj(m["timeline"]);
    case "selectTheme":
      return isStr(m["theme"]);
    case "createAnnotation":
      return (m["type"] === "highlight" || m["type"] === "note")
        && isNum(m["pageNumber"]) && isStr(m["content"]);
    case "deleteAnnotation":
      return isStr(m["id"]) && m["id"].length > 0;
    case "updateAnnotation":
      return isStr(m["id"]) && m["id"].length > 0 && isStr(m["content"]) && m["content"].length > 0;
    case "saveReadingState":
      return isObj(m["state"]);
    case "copyWithCitation":
      return isStr(m["text"]) && isNum(m["pageNumber"]);
    case "copyText":
      return isStr(m["text"]);
    case "exportAnnotations":
      return m["target"] === "clipboard" || m["target"] === "file";
    case "openExternalLink":
      return isStr(m["url"]);
    case "citeInProject":
      return isCiteInProject(m);
    default:
      return false;
  }
}

const EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * Accepts only web and mail links so a crafted PDF cannot make the host open file:, command: or vscode: URIs.
 * @returns true when the URL parses and uses an allowed scheme.
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    return EXTERNAL_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}
