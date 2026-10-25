// Content script of search result pages: picks the page adapter for the current page and watches its results.
import { isGoogleSearchUrl, googleResults, isPaperHit, readGoogleResult } from "./googleParse";
import { isScholarUrl, readResult } from "./scholarParse";
import { closeMenu, askNoPdf, showMenu } from "@labshelf/core/dom";
import {
  sendRuntime,
  type FoldersData,
  type LibraryRef,
  type SaveOutcome,
  type LookupData,
  type SearchHit,
} from "../platform";
import { lookupItemFor } from "./searchHitIds";
import {
  type IfNoPdf,
  PAPERS_DIR,
  formatError,
  formatFolderPathLabel,
  icon,
  formatPdfSourceLabel,
  type IconName,
} from "@labshelf/core";
import tokensCss from "@labshelf/core/styles/tokens.css";
import baseCss from "@labshelf/core/styles/base.css";

// base.css styles <body>; in a shadow root the root's children play that part
// (the host itself is reset inline, which outranks any :host rule).
const KIT_CSS = `${tokensCss
  .replace(/:root\[data-theme="light"\]/g, ':host([data-theme="light"])')
  .replace(/:root/g, ":host")}\n${baseCss}
:host > * { font-family: var(--ls-font); font-size: var(--ls-font-size); line-height: 1.4; color: var(--ls-fg); -webkit-font-smoothing: antialiased; }`;

/**
 * Attaches a shadow root to `host` carrying the kit plus `extraCss`. The
 * host's own box (`hostStyle`) is set inline: page selectors such as
 * ".gs_ggsd div { margin }" reach the host element, and inline styles beat them.
 */
function kitShadow(host: HTMLElement, extraCss: string, hostStyle: string): ShadowRoot {
  host.style.cssText = `all: initial; ${hostStyle}`;
  host.dataset["theme"] = pageTheme();
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `${KIT_CSS}\n${extraCss}`;
  root.append(style);
  return root;
}

// Light unless the page paints a dark background.
function pageTheme(): "light" | "dark" {
  for (const el of [document.body, document.documentElement]) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(getComputedStyle(el).backgroundColor);
    if (!m || m[4] === "0") continue;
    const luminance = (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255;
    return luminance < 0.4 ? "dark" : "light";
  }
  return "light";
}

const BUTTON_CSS = `
.lsx { display: inline-flex; align-items: stretch; height: 24px; font-size: 12px; line-height: 16px; border-radius: var(--ls-radius); background: var(--ls-button2-bg); color: var(--ls-button2-fg); }
.lsx button { display: inline-flex; align-items: center; margin: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; transition: background var(--ls-fast); }
.lsx button:hover { background: var(--ls-button2-hover); }
.lsx-main { gap: 7px; padding: 0 10px 0 4px; border-radius: var(--ls-radius) 0 0 var(--ls-radius); white-space: nowrap; }
.lsx-caret { justify-content: center; width: 22px; padding: 0; border-radius: 0 var(--ls-radius) var(--ls-radius) 0; }
.lsx-caret svg { width: 14px; height: 14px; opacity: .8; }
.lsx-sep { width: 1px; margin: 5px 0; background: var(--ls-border-soft); }
.lsx-mark { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; flex-shrink: 0;
  border-radius: var(--ls-radius-sm); background: var(--ls-button-bg); color: var(--ls-button-fg); }
.lsx-mark svg { width: 11px; height: 11px; }
.lsx[data-state="saving"] .lsx-mark svg { animation: lsx-spin 1.2s linear infinite; }
.lsx[data-state="saving"] button { cursor: progress; }
.lsx[data-state="saved"] .lsx-mark { background: var(--ls-status-done); }
.lsx[data-state="saved"] .lsx-sep, .lsx[data-state="saved"] .lsx-caret { display: none; }
.lsx[data-state="saved"] .lsx-main { border-radius: var(--ls-radius); }
.lsx[data-state="error"] .lsx-mark { background: var(--ls-error); }
.lsx[data-state="confirm"] .lsx-mark { background: var(--ls-yellow); }
/* Saved without a PDF: a muted badge, not the green "done" mark. Placed after
   the saved rule so it wins at equal specificity. */
.lsx[data-pdf="none"] .lsx-mark { background: var(--ls-badge-bg); color: var(--ls-badge-fg); }
@keyframes lsx-spin { to { transform: rotate(360deg); } }
`;

type ButtonState = "idle" | "saving" | "saved" | "error" | "confirm";

/** A mounted button and the hit it saves. */
interface ResultButton {
  hit: SearchHit;
  box: HTMLElement;
  main: HTMLButtonElement;
  caret: HTMLButtonElement;
  saved?: Pick<LibraryRef, "folder" | "id" | "hasPdf">;
}

/** Marks page elements the content script added or already handled. */
const MOUNTED_ATTR = "data-lsx";
let overlay: ShadowRoot | undefined;

const LABELS: Record<ButtonState, { glyph: IconName; text: string }> = {
  idle: { glyph: "logo", text: "Save to LabShelf" },
  saving: { glyph: "refresh", text: "Finding PDF…" },
  saved: { glyph: "check", text: "In LabShelf" },
  error: { glyph: "warning", text: "Try again" },
  confirm: { glyph: "warning", text: "No PDF found" },
};

function setState(m: ResultButton, state: ButtonState, title: string): void {
  m.box.dataset["state"] = state;
  const { glyph, text } = LABELS[state];
  m.main.innerHTML = `<span class="lsx-mark">${icon(glyph)}</span><span></span>`;
  m.main.querySelector("span:last-child")!.textContent = text;
  m.main.title = title;
  m.main.setAttribute("aria-label", title);
}

/** Shows the button as "In LabShelf"; a click then opens the paper. */
function markSaved(m: ResultButton, ref: Pick<LibraryRef, "folder" | "id" | "hasPdf">, detail: string): void {
  m.saved = ref;
  const title = ref.hasPdf
    ? `In your LabShelf library${detail ? ` — ${detail}` : ""}. Click to open it.`
    : "In your LabShelf library, but without a PDF — LabShelf found none. Click to open it; the library's Find PDF can retry.";
  setState(m, "saved", title);
  m.box.dataset["pdf"] = ref.hasPdf ? "" : "none";
  // A saved paper without its PDF reads distinctly, not as a complete capture.
  if (!ref.hasPdf) m.main.querySelector("span:last-child")!.textContent = "In LabShelf · no PDF";
}

async function save(m: ResultButton, folder?: string, ifNoPdf: IfNoPdf = "ask", retryPdf = false): Promise<void> {
  const state = m.box.dataset["state"];
  if (state === "saving" || state === "confirm") return;
  setState(m, "saving", "Saving to LabShelf — looking for the PDF…");
  try {
    const r = await sendRuntime<SaveOutcome>({
      type: "searchHit.save", hit: m.hit,
      ...(folder ? { folder } : {}), ifNoPdf, ...(retryPdf ? { retryPdf } : {}),
    });
    if (r.status === "no-pdf") {
      // Nothing was written: ask before saving the reference without its PDF.
      setState(m, "confirm", "No PDF found — choose whether to save the reference without it.");
      const choice = await askNoPdf(m.hit.title, r.miss, overlayRoot());
      if (choice === "save" || choice === "open" || choice === "author") return save(m, folder, choice);
      if (choice === "retry") return save(m, folder, "ask", true);
      setState(m, "idle", "Not saved — no PDF was found. Click to try again.");
      return;
    }
    const detail = r.alreadyInLibrary ? "it was already there" : r.pdfSource ? `PDF via ${formatPdfSourceLabel(r.pdfSource)}` : "saved without a PDF";
    markSaved(m, { folder: r.folder, id: r.id, hasPdf: r.hasPdf }, detail);
  } catch (err) {
    setState(m, "error", `Could not save: ${formatError(err)}. Click to retry.`);
  }
}

function overlayRoot(): ShadowRoot {
  if (!overlay) {
    const host = document.createElement("div");
    host.setAttribute(MOUNTED_ATTR, "overlay");
    document.documentElement.append(host);
    overlay = kitShadow(host, "", "position: fixed; top: 0; left: 0; z-index: 2147483000;");
  }
  return overlay;
}

async function openFolderMenu(m: ResultButton): Promise<void> {
  let data: FoldersData;
  try {
    data = await sendRuntime<FoldersData>({ type: "library.folders" });
  } catch {
    return;
  }
  showMenu(m.caret, data.folders.map((f) => ({
    label: formatFolderPathLabel(PAPERS_DIR, f.path, "/"),
    icon: f.depth === 0 ? ("library" as const) : ("folder" as const),
    ...(f.path === data.lastFolder ? { hint: "last used" } : {}),
    onSelect: () => { void save(m, f.path); },
  })), { root: overlayRoot() });
}

/**
 * Builds the button for `hit` inside `host`, which the page adapter has already placed;
 * `hostStyle` sets the host's own box against the page's stylesheet.
 */
function mountResultButton(host: HTMLElement, hit: SearchHit, hostStyle: string): ResultButton {
  host.setAttribute(MOUNTED_ATTR, "button");
  const root = kitShadow(host, BUTTON_CSS, hostStyle);
  const box = document.createElement("div");
  box.className = "lsx";
  box.innerHTML =
    `<button class="lsx-main" type="button"></button>` +
    `<span class="lsx-sep" aria-hidden="true"></span>` +
    `<button class="lsx-caret" type="button" title="Save to a folder…" aria-label="Save to a folder" aria-haspopup="menu">${icon("chevron-down")}</button>`;
  root.append(box);

  const m: ResultButton = { hit, box, main: box.querySelector(".lsx-main")!, caret: box.querySelector(".lsx-caret")! };
  setState(m, "idle", "Save to LabShelf, into the folder used last");
  m.main.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (m.saved) void sendRuntime({ type: "library.open", folder: m.saved.folder, paperId: m.saved.id });
    else void save(m);
  });
  m.caret.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const state = box.dataset["state"];
    if (state !== "saving" && state !== "confirm") void openFolderMenu(m);
  });
  return m;
}

/** What a search page tells the shared button: where its results are, what each one is, and where its button goes. */
interface SearchPage {
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
function watchResults(page: SearchPage): void {
  void scan(page);
  let pending: number | undefined;
  new MutationObserver(() => {
    window.clearTimeout(pending);
    pending = window.setTimeout(() => { void scan(page); }, 200);
  }).observe(document.body, { childList: true, subtree: true });
  // Navigating away from a page leaves no stray menu behind.
  window.addEventListener("pagehide", closeMenu);
}

const SCHOLAR_PAGE: SearchPage = {
  results: () => [...document.querySelectorAll(".gs_r.gs_or")],
  readHit: readResult,
  place(result, host) {
    // Scholar's right column; results without a PDF link get one built the same way.
    let column = result.querySelector(".gs_ggs .gs_ggsd");
    if (!column) {
      const ggs = document.createElement("div");
      ggs.className = "gs_ggs gs_fl";
      column = document.createElement("div");
      column.className = "gs_ggsd";
      ggs.append(column);
      result.insertBefore(ggs, result.querySelector(".gs_ri"));
    }
    column.append(host);
    return true;
  },
  hostStyle: "display: block; margin: 8px 0 2px;",
};

const GOOGLE_PAGE: SearchPage = {
  results: () => googleResults(document),
  readHit(result) {
    const hit = readGoogleResult(result);
    return hit && isPaperHit(hit) ? hit : undefined;
  },
  place(result, host) {
    // The visible URL line (site name, cite, "⋮") is the title link wrapper's sibling that holds a <cite>;
    // the copy inside the link is hidden. No such line: no button rather than one in a wrong spot.
    const wrapper = result.querySelector("a[href] > h3")?.parentElement?.parentElement;
    const line = wrapper && [...(wrapper.parentElement?.children ?? [])].find((c) => c !== wrapper && c.querySelector("cite"));
    if (!line) return false;
    line.append(host);
    return true;
  },
  hostStyle: "display: block; align-self: center; flex-shrink: 0; margin-left: 8px;",
};

if (isScholarUrl(location.href)) watchResults(SCHOLAR_PAGE);
else if (isGoogleSearchUrl(location.href)) watchResults(GOOGLE_PAGE);
