// Finds a search page's results through its page adapter, mounts a button on each hit and marks the ones already saved.
import { closeMenu } from "@labshelf/core/dom";
import { sendRuntime } from "../../platform";
import type { LookupData, SearchHit } from "../../platform";
import { lookupItemFor } from "../searchHitIds";
import { MOUNTED_ATTR, markSaved, mountResultButton, type ResultButton } from "./resultButton";

/** What a search page tells the shared button: where its results are, what each one is, and where its button goes. */
export interface SearchPage {
  /** Result blocks currently on the page; blocks already handled are skipped. */
  results(): Element[];
  /** The hit a result block shows, or undefined when it gets no button. */
  readHit(result: Element): SearchHit | undefined;
  /** Inserts the button's host element into the result, or returns false when the result has no place for it. */
  place(result: Element, host: HTMLElement): boolean;
  /** Inline style of the host element, which page selectors cannot override. */
  hostStyle: string;
}

const mounted = new Map<string, ResultButton>();

function mount(page: SearchPage, result: Element): ResultButton | undefined {
  if (result.hasAttribute(MOUNTED_ATTR)) return undefined;
  result.setAttribute(MOUNTED_ATTR, "1");
  const hit = page.readHit(result);
  if (!hit) return undefined;
  const host = document.createElement("div");
  if (!page.place(result, host)) return undefined;
  const m = mountResultButton(host, hit, page.hostStyle);
  mounted.set(hit.key, m);
  return m;
}

async function scan(page: SearchPage): Promise<void> {
  const fresh = page.results().map((r) => mount(page, r)).filter((m): m is ResultButton => !!m);
  if (!fresh.length) return;
  try {
    const known = await sendRuntime<LookupData>({ type: "library.lookup", items: fresh.map((m) => lookupItemFor(m.hit)) });
    for (const [key, ref] of Object.entries(known)) {
      const m = mounted.get(key);
      if (m) markSaved(m, ref, "");
    }
  } catch {
    // The background is unavailable (extension reloading): buttons stay "Save to LabShelf".
  }
}

/** Mounts buttons on the page's results now and on every result the page adds later. */
export function watchResults(page: SearchPage): void {
  void scan(page);
  let pending: number | undefined;
  new MutationObserver(() => {
    window.clearTimeout(pending);
    pending = window.setTimeout(() => { void scan(page); }, 200);
  }).observe(document.body, { childList: true, subtree: true });
  // Navigating away from a page leaves no stray menu behind.
  window.addEventListener("pagehide", closeMenu);
}
