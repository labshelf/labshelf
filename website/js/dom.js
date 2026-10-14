// Shared DOM helpers for the site's reader: element lookup and creation, storage, toasts, clipboard and scrolling to a target.

export const viewer = document.getElementById("viewerContainer");
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const TOOLBAR_H = 38;

export function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

/** Create an element; `class` and `html` are special, `on*` keys add listeners, every other key is an attribute. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "html") el.innerHTML = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) el.append(child);
  }
  return el;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private window, blocked site data): the change lasts for this visit.
  }
}

let toastTimer = 0;
export function toast(message) {
  const el = byId("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function pages() {
  return [...viewer.querySelectorAll("#viewer > .page")];
}

export function pageOf(node) {
  const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return el?.closest("#viewer > .page") ?? null;
}

export function pageNumber(el) {
  return Number(pageOf(el)?.dataset.page ?? 0);
}

/** Top of `el` in the viewer's scroll coordinates. */
export function offsetInViewer(el) {
  return el.getBoundingClientRect().top - viewer.getBoundingClientRect().top + viewer.scrollTop;
}

/** Scroll so `el` sits just under the toolbar, or in the middle of the viewer when `center` is set. */
export function scrollToElement(el, center = false) {
  const offset = center ? viewer.clientHeight / 2 - el.offsetHeight / 2 : TOOLBAR_H + 16;
  viewer.scrollTo({ top: Math.max(0, offsetInViewer(el) - offset) });
}

export function isTyping(target) {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}
