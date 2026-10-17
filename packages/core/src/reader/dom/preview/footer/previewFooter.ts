// Mounts the preview footer: where the page sits in the document, the build status and the slots the checks fill.
import { el } from "../../../../ui/dom/index.js";
import type { PreviewRoots } from "../../../index.js";
import type { PreviewOutlineSource } from "../mountPreviewChrome.js";
import { createCrumbs, type LoadedOutline } from "./crumbs.js";
import { createStatusView } from "./statusView.js";
import type { PreviewBuildStatus } from "./buildStatusText.js";

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
  setRoots(roots: PreviewRoots): void;
  setBuild(build: PreviewBuildStatus): void;
  /** The open document was replaced, so its outline is read again. */
  documentChanged(): void;
}

const SLOT_NAMES: FooterSlotName[] = ["cites", "limit", "checks"];

function createSlots(): Record<FooterSlotName, HTMLElement> {
  return Object.fromEntries(
    SLOT_NAMES.map((name) => [name, el("span", { class: "rd-preview-slot", "data-slot": name, hidden: true })]),
  ) as Record<FooterSlotName, HTMLElement>;
}

/**
 * Mounts the footer; the caller inserts `element` into the shell.
 * @returns the element, its empty slots and the setters the host messages drive.
 */
export function mountPreviewFooter({ openLogs, outline, now = Date.now }: PreviewFooterDeps): PreviewFooter {
  let roots: PreviewRoots | null = null;
  let build: PreviewBuildStatus = { state: "succeeded", errors: 0 };
  let loaded: LoadedOutline = { rows: [], pages: [] };
  let started = false;
  // INVARIANT: only the load started last may land, so the outline of a replaced document never shows.
  let generation = 0;

  const slots = createSlots();
  const crumbs = createCrumbs(outline);
  const status = createStatusView({ openLogs, now });
  const element = el("footer", { class: "rd-preview-footer" }, crumbs.element,
    el("div", { class: "rd-preview-footer-end" }, status.element, slots.cites, slots.limit, slots.checks));

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
