/**
 * Validates untrusted messages from the reader and the links a PDF asks the host to open.
 */
import { isNumber, isRecord, isString } from "../../guards/index.js";
import { checkPreviewRequest, type PreviewRequest } from "../previewRequests.js";
import type { WebviewToHost } from "./webviewToHost.js";

const MAX_CITE_QUOTE_LENGTH = 2000;

function isCiteInProject(m: Record<string, unknown>): boolean {
  const { paperId, page, quote } = m;
  return isString(paperId) && paperId.length > 0
    && (page === undefined || (Number.isInteger(page) && (page as number) >= 1))
    && (quote === undefined || (isString(quote) && quote.length <= MAX_CITE_QUOTE_LENGTH));
}

/**
 * Validates an untrusted webview message against the protocol; anything malformed is rejected so host handlers never see partial payloads.
 * @returns true when `raw` is a well-formed WebviewToHost message.
 */
export function isWebviewMessage(raw: unknown): raw is WebviewToHost {
  if (!isRecord(raw) || !isString(raw["command"])) { return false; }
  const m = raw;
  const preview = checkPreviewRequest(m);
  if (preview !== null) { return preview; }
  switch (m["command"] as Exclude<WebviewToHost, PreviewRequest>["command"]) {
    case "ready-for-init":
      return true;
    case "ready":
      return isNumber(m["totalPages"]);
    case "perf":
      return isRecord(m["timeline"]);
    case "selectTheme":
      return isString(m["theme"]);
    case "createAnnotation":
      return (m["type"] === "highlight" || m["type"] === "note")
        && isNumber(m["pageNumber"]) && isString(m["content"]);
    case "deleteAnnotation":
      return isString(m["id"]) && m["id"].length > 0;
    case "updateAnnotation":
      return isString(m["id"]) && m["id"].length > 0 && isString(m["content"]) && m["content"].length > 0;
    case "saveReadingState":
      return isRecord(m["state"]);
    case "copyWithCitation":
      return isString(m["text"]) && isNumber(m["pageNumber"]);
    case "copyText":
      return isString(m["text"]);
    case "exportAnnotations":
      return m["target"] === "clipboard" || m["target"] === "file";
    case "openExternalLink":
      return isString(m["url"]);
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
