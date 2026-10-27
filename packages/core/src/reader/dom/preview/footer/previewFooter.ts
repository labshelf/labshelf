// Mounts the preview footer: where the page sits in the document, the build status and the slots the checks fill.
import { renderElement } from "../../../../ui/dom/index.js";
import { type PreviewBuildRoots, deriveOutlineTrail, type OutlineRow } from "../../../index.js";
import type { PreviewOutlineSource } from "../mountPreviewChrome.js";
import { type PreviewBuildState, formatBuildStateText } from "./buildStateText.js";
import { renderIcon } from "../../../../ui/index.js";
import { buildMenu, updatePopoverOpen } from "../../elements/index.js";
import { derivePdfName } from "../deriveFileName.js";

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

export interface PreviewFooter {
  element: HTMLElement;
  slots: Record<FooterSlotName, HTMLElement>;
  setRoots(roots: PreviewBuildRoots): void;
  setBuild(build: PreviewBuildState): void;
  /** The open document was replaced, so its outline is read again. */
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
