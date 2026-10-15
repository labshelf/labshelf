/**
 * Provides the DOM helpers every DOM surface shares: element lookup that fails loudly, search-term
 * highlighting, and a terse element factory. Framework-free on purpose.
 */
import { escapeHtml } from "../escapeHtml.js";
import { highlightRanges } from "../../library/search/index.js";

/** Returns the element with the given id or throws — missing mount points are programmer errors. */
export function $<T extends HTMLElement = HTMLElement>(id: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(`#${id}`);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

/** Escapes `text` and wraps every occurrence of each search term in <mark>, ignoring case and accents. */
export function highlight(text: unknown, terms: string[]): string {
  const str = String(text ?? "");
  let out = "";
  let pos = 0;
  for (const [from, to] of highlightRanges(str, terms)) {
    out += escapeHtml(str.slice(pos, from)) + "<mark>" + escapeHtml(str.slice(from, to)) + "</mark>";
    pos = to;
  }
  return out + escapeHtml(str.slice(pos));
}

type Attrs = Record<string, string | number | boolean | null | undefined>;

/** Creates an element with attributes and children; `html` sets innerHTML, `text` sets textContent. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs & { html?: string; text?: string } = {},
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "html") node.innerHTML = String(value);
    else if (key === "text") node.textContent = String(value);
    else if (key === "class") node.className = String(value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

/** Formats an ISO timestamp as a short local time ("14:05") or date when not today. */
export function shortTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
