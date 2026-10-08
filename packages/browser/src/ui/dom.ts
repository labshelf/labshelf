/**
 * Small DOM helpers shared by every browser surface: element lookup that fails
 * loudly, HTML escaping for string templates, search-term highlighting, and a
 * terse element factory. Kept framework-free on purpose — the UI is vanilla TS.
 */
import { highlightRanges } from "@labshelf/core";

/** Returns the element with the given id or throws — missing mount points are programmer errors. */
export function $<T extends HTMLElement = HTMLElement>(id: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(`#${id}`);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

/** Escapes a value for safe interpolation into an HTML string. */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapes `text` and wraps every occurrence of each search term in <mark>, ignoring case and accents. */
export function highlight(text: unknown, terms: string[]): string {
  const str = String(text ?? "");
  let out = "";
  let pos = 0;
  for (const [from, to] of highlightRanges(str, terms)) {
    out += esc(str.slice(pos, from)) + "<mark>" + esc(str.slice(from, to)) + "</mark>";
    pos = to;
  }
  return out + esc(str.slice(pos));
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
