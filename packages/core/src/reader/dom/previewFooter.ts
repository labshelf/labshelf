// Builds the footer of a build preview: build state, checks, citation problems and the comment prompt.
import { renderElement, showToast } from "../../ui/dom/index.js";
import {
  type PreviewBuildRoots, deriveOutlineTrail, type OutlineRow, type BuildState, type PreviewBuildRoot, type PageArea,
  type PdfProblem, type WebviewToHost, type PagePoint,
} from "../index.js";
import type { PreviewOutlineSource } from "./previewChrome.js";
import { derivePdfName, deriveFileName } from "./previewProblems.js";
import { renderIcon, formatCount } from "../../ui/index.js";
import { buildMenu, updatePopoverOpen, deriveClampedNumber } from "./elements.js";
import { formatCompactTime } from "../../time/index.js";
import { derivePagePoint, type PageViewportLike } from "./navigation.js";
import type { ReaderContext } from "./readerSession.js";

// Mounts the preview footer: where the page sits in the document, the build status and the slots the checks fill.

interface LoadedOutline {
  rows: OutlineRow[];
  pages: Array<number | null>;
}

interface Crumbs {
  element: HTMLElement;
  /** Draws the trail for the shown path; does nothing when neither it nor the trail changed. */
  render(path: string | undefined, loaded: LoadedOutline): void;
}

function createCrumbs(outline: PreviewOutlineSource): Crumbs {
  const element = renderElement("nav", { class: "rd-preview-crumbs", "aria-label": "Document position" });
  let key = "";

  function openMenu(anchor: HTMLElement, rows: readonly OutlineRow[], trail: readonly OutlineRow[]): void {
    const inTrail = new Set(trail.map((r) => r.id));
    const items = rows
      .filter((r) => r.depth < 2)
      .map((r) => ({ label: r.title, checked: inTrail.has(r.id), run: () => outline.jump(r) }));
    updatePopoverOpen(anchor, buildMenu(items), "above");
  }

  return {
    element,
    render(path, loaded) {
      const name = path === undefined ? "" : derivePdfName(path);
      const trail = deriveOutlineTrail(loaded.rows, loaded.pages, outline.currentPage());
      const next = `${name}|${loaded.rows.length > 0}|${trail.map((r) => r.id).join(",")}`;
      if (next === key) { return; }
      key = next;
      const file = renderElement("span", { class: "rd-preview-file", title: path ?? "" }, name);
      if (loaded.rows.length === 0) { return element.replaceChildren(file); }
      const button = renderElement("button", { class: "rd-preview-crumb", type: "button", "aria-haspopup": "menu", "aria-expanded": "false" }, file);
      button.addEventListener("click", () => openMenu(button, loaded.rows, trail));
      const parts = trail.flatMap((r) => [
        renderElement("span", { class: "rd-preview-sep", "aria-hidden": "true", html: renderIcon("chevron-right") }),
        renderElement("span", { class: "rd-preview-crumb-title", title: r.title }, r.title),
      ]);
      element.replaceChildren(button, ...parts);
    },
  };
}

const CLOCK_MS = 30_000;

interface StatusViewDeps {
  openLogs: (root: string) => void;
  /** The clock the status ages against. */
  now: () => number;
}

interface StatusView {
  element: HTMLElement;
  render(roots: PreviewBuildRoots | null, build: PreviewBuildState): void;
}

function createStatusView({ openLogs, now }: StatusViewDeps): StatusView {
  const element = renderElement("div", { class: "rd-preview-status", role: "status", "aria-live": "polite" });
  let clock: ReturnType<typeof setInterval> | null = null;
  let latest: { roots: PreviewBuildRoots | null; build: PreviewBuildState } | null = null;

  function render(roots: PreviewBuildRoots | null, build: PreviewBuildState): void {
    latest = { roots, build };
    const { text, tone, logsRoot, timed } = formatBuildStateText(roots, build, now());
    element.dataset["tone"] = tone;
    const glyph = tone === "error" ? "warning" : null;
    const label = renderElement("span", { class: "rd-preview-status-text" }, text);
    const lead = glyph
      ? renderElement("span", { class: "rd-preview-status-icon", "aria-hidden": "true", html: renderIcon(glyph) })
      : renderElement("span", { class: "rd-preview-status-dot", "aria-hidden": "true" });
    const content = text === "" ? [label] : [lead, label];
    if (logsRoot === undefined) {
      element.replaceChildren(...content);
    } else {
      const button = renderElement("button", { class: "rd-preview-status-button", type: "button", title: "Open the build logs" }, ...content);
      button.addEventListener("click", () => openLogs(logsRoot));
      element.replaceChildren(button);
    }
    if (timed && clock === null) { clock = setInterval(() => latest && render(latest.roots, latest.build), CLOCK_MS); }
    if (!timed && clock !== null) { clearInterval(clock); clock = null; }
  }

  return { element, render };
}

type FooterSlotName = "cites" | "limit" | "checks";

interface PreviewFooterDeps {
  openLogs: (root: string) => void;
  outline: PreviewOutlineSource;
  /** The clock the status ages against. */
  now?: () => number;
}

interface PreviewFooter {
  element: HTMLElement;
  slots: Record<FooterSlotName, HTMLElement>;
  setRoots(roots: PreviewBuildRoots): void;
  setBuild(build: PreviewBuildState): void;
  /** Another document opened, so its outline is read again. */
  documentChanged(): void;
}

const SLOT_NAMES: FooterSlotName[] = ["cites", "limit", "checks"];

function createSlots(): Record<FooterSlotName, HTMLElement> {
  return Object.fromEntries(
    SLOT_NAMES.map((name) => [name, renderElement("span", { class: "rd-preview-slot", "data-slot": name, hidden: true })]),
  ) as Record<FooterSlotName, HTMLElement>;
}

function createFooterParts({ openLogs, outline, now = Date.now }: PreviewFooterDeps) {
  const slots = createSlots();
  const crumbs = createCrumbs(outline);
  const status = createStatusView({ openLogs, now });
  const element = renderElement("footer", { class: "rd-preview-footer" }, crumbs.element,
    renderElement("div", { class: "rd-preview-footer-end" }, status.element, slots.cites, slots.limit, slots.checks));
  return { slots, crumbs, status, element };
}

/**
 * Mounts the footer; the caller inserts `element` into the shell.
 * @returns the element, its empty slots and the setters the host messages drive.
 */
export function mountPreviewFooter(deps: PreviewFooterDeps): PreviewFooter {
  const { outline } = deps;
  let roots: PreviewBuildRoots | null = null;
  let build: PreviewBuildState = { state: "succeeded", errors: 0 };
  let loaded: LoadedOutline = { rows: [], pages: [] };
  let started = false;
  // INVARIANT: only the load started last may land, so the outline of a replaced document never shows.
  let generation = 0;

  const { slots, crumbs, status, element } = createFooterParts(deps);

  const renderCrumbs = (): void => crumbs.render(roots?.shown, loaded);
  const renderStatus = (): void => status.render(roots, build);

  async function loadOutline(): Promise<void> {
    const mine = ++generation;
    try {
      const result = await outline.load();
      if (mine !== generation) { return; }
      loaded = result;
    } catch (err) {
      if (mine !== generation) { return; }
      console.warn("LabShelf reader: could not load the outline for the footer", err);
      loaded = { rows: [], pages: [] };
    }
    renderCrumbs();
  }

  outline.onPageChange(renderCrumbs);
  renderStatus();

  return {
    element,
    slots,
    setRoots(next) {
      roots = next;
      renderCrumbs();
      renderStatus();
      if (!started) { started = true; void loadOutline(); }
    },
    setBuild(next) {
      build = next;
      renderStatus();
    },
    documentChanged() {
      void loadOutline();
    },
  };
}

// Chooses what the preview footer's status says from the build state and the build roots.

export interface PreviewBuildState {
  state: BuildState;
  errors: number;
  /** The source changed after this build. */
  stale?: boolean;
  /** When the build finished, in epoch milliseconds. */
  builtAt?: number;
}

interface BuildStateText {
  text: string;
  tone: "busy" | "error" | "warning" | "";
  /** The root whose logs a click opens; absent when the status is plain text. */
  logsRoot?: string;
  /** The text ages, so it needs a periodic refresh. */
  timed?: boolean;
}

const errorCount = (root: PreviewBuildRoot): number => root.problems.filter((p) => p.severity === "error").length;
/** Sentence text for the build's age: "just now", "2 min ago", "3 h ago". */
function age(builtAt: number, now: number): string {
  const elapsed = formatCompactTime(builtAt, now);
  return elapsed === "now" ? "just now" : `${elapsed} ago`;
}
const count = (n: number): string => `${n} ${n === 1 ? "error" : "errors"}`;

function failure(label: string, errors: number, separator: string, logsRoot?: string): BuildStateText {
  const text = errors > 0 ? `${label}${separator}${count(errors)}` : label;
  return { text, tone: "error", ...(logsRoot === undefined ? {} : { logsRoot }) };
}

/** Precedence: building, then the shown root's failure, the focused root's, stale source, and the build's age. */
function formatBuildStateText(roots: PreviewBuildRoots | null, build: PreviewBuildState, now: number): BuildStateText {
  if (build.state === "building") { return { text: "Compiling…", tone: "busy" }; }
  // Before the roots arrive the build message alone says whether the shown document failed.
  if (!roots) { return build.state === "failed" ? failure("Build failed", build.errors, " · ") : { text: "", tone: "" }; }
  const shown = roots.roots.find((r) => r.path === roots.shown);
  if (shown?.failed) { return failure("Build failed", errorCount(shown), " · ", shown.path); }
  const focused = roots.focused === roots.shown ? undefined : roots.roots.find((r) => r.path === roots.focused);
  if (focused?.failed) { return failure(deriveFileName(focused.path), errorCount(focused), ": ", focused.path); }
  if (build.stale) { return { text: "Source changed", tone: "warning" }; }
  if (build.builtAt !== undefined) {
    return { text: `Compiled ${age(build.builtAt, now)}`, tone: "", timed: true };
  }
  return { text: "", tone: "" };
}

// Shows the cite count and the problems left in the shown PDF, and steps through them with prev/next chevrons.

interface ProblemsDeps {
  /** The reader's problem marks; `index` counts into the shown root's `pdfProblems`. */
  marks: { flash(index: number): void };
  scrollTo(area: PageArea): void;
  post: (msg: WebviewToHost) => void;
}

export interface PreviewProblems {
  setRoots(roots: PreviewBuildRoots): void;
  /** Moves to the next (1) or previous (-1) problem, wrapping at the ends. */
  step(dir: 1 | -1): void;
}

function arrow(label: string, glyph: "chevron-left" | "chevron-right", onClick: () => void): HTMLButtonElement {
  const button = renderElement("button", { class: "rd-preview-problem-step", type: "button", title: label, "aria-label": label, html: renderIcon(glyph) });
  button.addEventListener("click", onClick);
  return button;
}

/** Fills the footer's cites slot; the caller owns the slot element and feeds it the roots. */
export function mountProblems(slot: HTMLElement, { marks, scrollTo, post }: ProblemsDeps): PreviewProblems {
  let problems: PdfProblem[] = [];
  // Index of the problem last shown; -1 before the first step, so next lands on 0 and previous on the last.
  let at = -1;

  function reveal(problem: PdfProblem, index: number): void {
    if (problem.area) {
      scrollTo(problem.area);
      marks.flash(index);
      return;
    }
    showToast(problem.message);
    if (problem.file !== undefined && problem.line !== undefined) {
      post({ command: "openSourceLine", file: problem.file, line: problem.line });
    }
  }

  function step(dir: 1 | -1): void {
    if (problems.length === 0) {
      showToast("No problems in the PDF");
      return;
    }
    at = at === -1 && dir === -1 ? problems.length - 1 : (at + dir + problems.length) % problems.length;
    reveal(problems[at]!, at);
  }

  return {
    step,
    setRoots(roots) {
      const shown = roots.roots.find((r) => r.path === roots.shown);
      problems = shown?.pdfProblems ?? [];
      at = -1;
      const cites = shown?.cites;
      slot.hidden = cites === undefined && problems.length === 0;
      const status = renderElement("span", { class: "rd-preview-cites", role: "status", "aria-live": "polite" }, formatCount(cites ?? 0, "cite"));
      if (problems.length > 0) {
        const tone = problems.some((p) => p.kind === "undefinedCitation") ? "error" : "warning";
        status.append(" · ", renderElement("span", { class: "rd-preview-to-fix", "data-tone": tone }, `${problems.length} to fix`));
      }
      slot.replaceChildren(status);
      if (problems.length > 0) {
        slot.append(arrow("Previous problem", "chevron-left", () => step(-1)), arrow("Next problem", "chevron-right", () => step(1)));
      }
    },
  };
}

// Asks for a review note on text selected in a build preview and sends it to the host as a comment at the source behind it.

/** The selected text, the page element it is on, and on screen its first line and its whole extent. */
interface CommentSelection {
  text: string;
  pageNumber: number;
  page: HTMLElement;
  start: DOMRect;
  bounds: DOMRect;
}

const MARGIN = 8;

export class CommentAsk {
  private readonly input = renderElement("textarea", { class: "rd-review-note-input", rows: "3", placeholder: "Comment on the source", "aria-label": "Comment" });
  private readonly box: HTMLElement;
  private pending: { point: PagePoint; quote: string } | null = null;

  constructor(private readonly ctx: ReaderContext) {
    const cancel = renderElement("button", { class: "rd-review-note-btn", type: "button", text: "Cancel" });
    const submit = renderElement("button", { class: "rd-review-note-btn rd-review-note-submit", type: "button", text: "Comment" });
    this.box = renderElement("div", { class: "rd-review-note", role: "dialog", "aria-label": "Comment on the source" },
      this.input, renderElement("div", { class: "rd-review-note-actions" }, cancel, submit));
    cancel.addEventListener("click", () => this.close());
    submit.addEventListener("click", () => this.submit());
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); this.close(); }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); this.submit(); }
    });
    document.body.append(this.box);
  }

  /** Opens the note under the selection; a page that pdf.js has not laid out yet gives no point, so nothing opens. */
  open(selection: CommentSelection): void {
    const point = this.pointOf(selection);
    if (!point) { return; }
    this.pending = { point, quote: selection.text };
    this.input.value = "";
    this.box.classList.add("rd-visible");
    const own = this.box.getBoundingClientRect();
    const below = selection.bounds.bottom + MARGIN;
    const top = below + own.height <= window.innerHeight - MARGIN ? below : selection.bounds.top - own.height - MARGIN;
    this.box.style.top = `${deriveClampedNumber(top, MARGIN, window.innerHeight - own.height - MARGIN)}px`;
    this.box.style.left = `${deriveClampedNumber(selection.bounds.left, MARGIN, window.innerWidth - own.width - MARGIN)}px`;
    this.input.focus();
  }

  private submit(): void {
    const note = this.input.value.trim();
    if (!this.pending || !note) { this.input.focus(); return; }
    this.ctx.host.post({ command: "addReviewComment", point: this.pending.point, quote: this.pending.quote, note });
    this.close();
  }

  private close(): void {
    this.pending = null;
    this.box.classList.remove("rd-visible");
  }

  // The start of the selection's first line, which SyncTeX maps to the source line the quote begins on.
  private pointOf({ pageNumber, page, start }: CommentSelection): PagePoint | undefined {
    const view = this.ctx.pdfViewer.getPageView(pageNumber - 1) as { viewport?: PageViewportLike } | undefined;
    if (!view?.viewport) { return undefined; }
    const box = page.getBoundingClientRect();
    const x = start.left + 1 - box.left - page.clientLeft;
    const y = start.top + start.height / 2 - box.top - page.clientTop;
    return derivePagePoint(pageNumber, view.viewport, x, y);
  }
}
