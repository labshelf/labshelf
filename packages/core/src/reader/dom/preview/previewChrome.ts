// Builds the chrome a build preview adds to the reader: its header, menus, outline source and page counting.
import type { PDFDocumentProxy } from "pdfjs-dist";
import { findElement, showMenu, type MenuEntry, renderElement } from "../../../ui/dom/index.js";
import {
  type PageArea, type PreviewBuildRoots, type WebviewToHost, type OutlineRow, type BuildOptions, type PreviewBuildRoot,
  deriveOutlineRows, type RawOutlineNode, deriveClampedPage,
} from "../../index.js";
import type { ReaderContext } from "../session/index.js";
import { type LogsView, mountProblemMarks, mountLimitMeter } from "./previewProblems.js";
import { mountPreviewFooter, mountProblems, type PreviewProblems, type PreviewBuildState } from "./previewFooter.js";
import { renderIcon } from "../../../ui/index.js";
import { formatEngineLabel } from "../../../latex/index.js";
import { AUTO_COMPILE_MODES, LATEX_ENGINES, formatAutoCompileLabel } from "../../../writing/index.js";
import { renderReaderIconButton, buildMenu, updatePopoverOpen, type MenuItem } from "../highlights/elements.js";
import { resolveOutlinePages } from "../sidebar/index.js";
import { derivePaperBody, derivePdfTextLines, type PdfTextItem } from "../../../writing/checks/index.js";

// Composes a preview's chrome around the reader: the header above the pages, the footer below them, and the logs and problem marks over them.

export interface PreviewOutlineSource {
  load(): Promise<{ rows: OutlineRow[]; pages: Array<number | null> }>;
  currentPage(): number;
  onPageChange(fn: () => void): void;
  jump(row: OutlineRow): void;
}

interface PreviewChromeDeps {
  post: (msg: WebviewToHost) => void;
  logs: Pick<LogsView, "open" | "setRoots">;
  /** The PDF outline the footer's breadcrumb follows. */
  outline: PreviewOutlineSource;
  /** Counts the body pages of the open document. */
  countBodyPages: () => Promise<number>;
  /** The viewer the problem marks are drawn over. */
  pdfViewer: ReaderContext["pdfViewer"];
  /** Brings a problem's area into view. */
  scrollTo(area: PageArea): void;
  /** Draws the pages dark (true) or as light paper (false); the Dark PDF button calls it. */
  setPagesDark(dark: boolean): void;
}

export interface PreviewChrome {
  applyRoots(roots: PreviewBuildRoots): void;
  applyBuild(build: PreviewBuildState): void;
  /** The open document was replaced, so its body pages are counted again. */
  documentChanged(): void;
  /** Steps through the shown PDF's problems; the Next/Previous problem keys call it. */
  problems: PreviewProblems;
}

function recompileState({ state, stale }: PreviewBuildState): RecompileState {
  if (state === "building") { return "building"; }
  return stale ? "stale" : "current";
}

/**
 * Inserts the preview header and footer into the shell, draws the problem marks over the pages and switches the document to preview layout.
 * @returns handles the reader's host messages call to refresh the chrome.
 */
export function mountPreviewChrome({ post, logs, outline, countBodyPages, pdfViewer, scrollTo, setPagesDark }: PreviewChromeDeps): PreviewChrome {
  const header = mountPreviewHeader({ post, pill: findElement("status-pill"), setPagesDark });
  findElement("viewerContainer").before(header.element);
  document.documentElement.classList.add("rd-preview");
  const footer = mountPreviewFooter({ openLogs: (path) => logs.open(path), outline });
  findElement("viewerContainer").after(footer.element);

  const marks = mountProblemMarks({ container: findElement("viewerContainer"), pdfViewer });
  const options = mountBuildMenu(header.slots.options, { post });
  const only = mountOnlyToggle(header.slots.only, { post });
  const logsButton = mountLogsButton(header.slots.logs, { post, openLogs: (path) => logs.open(path) });
  const problems = mountProblems(footer.slots.cites, { marks, scrollTo, post });
  const limit = mountLimitMeter(footer.slots.limit, { post, countBodyPages });
  const checks = mountChecksButton(footer.slots.checks, { post });

  return {
    applyRoots(roots) {
      logs.setRoots(roots);
      footer.setRoots(roots);
      for (const piece of [options, only, logsButton, problems, limit, checks]) { piece.setRoots(roots); }
      marks.setProblems(roots.roots.find((r) => r.path === roots.shown)?.pdfProblems ?? []);
    },
    applyBuild(build) {
      header.setBuild(recompileState(build));
      footer.setBuild(build);
    },
    documentChanged() {
      footer.documentChanged();
      limit.documentChanged();
    },
    problems,
  };
}

// Shows the build options of the preview as a header menu: when to compile and, for LaTeX roots, the engine and whether to stop at the first error.

interface OptionsMenuDeps {
  post: (msg: WebviewToHost) => void;
}

function entries(options: BuildOptions, post: OptionsMenuDeps["post"]): MenuEntry[] {
  const list: MenuEntry[] = AUTO_COMPILE_MODES.map((mode) => ({
    label: formatAutoCompileLabel(mode), checked: mode === options.autoCompile, radio: true,
    onSelect: () => post({ command: "setAutoCompile", mode }),
  }));
  if (options.engine === undefined) { return list; }
  list.push("separator");
  for (const engine of LATEX_ENGINES) {
    list.push({ label: formatEngineLabel(engine), checked: engine === options.engine, radio: true, onSelect: () => post({ command: "setEngine", engine }) });
  }
  const halt = options.haltOnError === true;
  list.push(
    "separator",
    { label: "Stop on first error", checked: halt, radio: true, onSelect: () => post({ command: "setHaltOnError", on: true }) },
    { label: "Try to compile despite errors", checked: !halt, radio: true, onSelect: () => post({ command: "setHaltOnError", on: false }) },
  );
  return list;
}

/**
 * Mounts the chevron button into the header's `options` slot; the slot shows while the roots carry build options.
 * @returns `setRoots`, which the host's roots messages drive.
 */
export function mountBuildMenu(slot: HTMLElement, { post }: OptionsMenuDeps): { setRoots(roots: PreviewBuildRoots): void } {
  const button = renderReaderIconButton(renderIcon("chevron-down"), "Build options");
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  let options: BuildOptions | undefined;

  button.addEventListener("click", () => {
    if (!options) { return; }
    button.setAttribute("aria-expanded", "true");
    showMenu(button, entries(options, post), {
      onClose: () => { button.setAttribute("aria-expanded", "false"); button.focus(); },
    });
  });
  slot.append(button);

  return {
    setRoots(roots) {
      options = roots.options;
      slot.hidden = options === undefined;
    },
  };
}

// Shows the shown root's warning and error count in the header, with a menu that opens each problem or the logs.

interface LogsButtonDeps {
  post: (msg: WebviewToHost) => void;
  openLogs(root: string): void;
}

function isProblem(p: PreviewBuildRoot["problems"][number]): boolean {
  return p.severity !== "info";
}

function menuItems(root: PreviewBuildRoot, { post, openLogs }: LogsButtonDeps): MenuItem[] {
  const items: MenuItem[] = [];
  root.problems.forEach((problem, index) => {
    if (!isProblem(problem)) { return; }
    const hint = problem.file === undefined ? undefined : problem.line === undefined ? problem.file : `${problem.file}:${problem.line}`;
    items.push({ label: problem.message, ...(hint !== undefined && { hint }), run: () => post({ command: "openProblem", root: root.path, index }) });
  });
  items.push({ label: "Show all", separatorBefore: items.length > 0, run: () => openLogs(root.path) });
  if (root.rawLog) { items.push({ label: "Open raw log", run: () => post({ command: "openRawLog", root: root.path }) }); }
  return items;
}

/**
 * Mounts the logs button into the header's `logs` slot and reveals the slot.
 * @returns `setRoots`, which the host's roots messages drive.
 */
export function mountLogsButton(slot: HTMLElement, deps: LogsButtonDeps): { setRoots(roots: PreviewBuildRoots): void } {
  const button = renderReaderIconButton(renderIcon("log"), "Logs");
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  const count = renderElement("span", { class: "rd-logs-count", "aria-hidden": "true", hidden: true });
  button.append(count);
  let shown: PreviewBuildRoot | undefined;

  button.addEventListener("click", () => {
    if (shown) { updatePopoverOpen(button, buildMenu(menuItems(shown, deps)), "below"); }
  });
  slot.hidden = false;
  slot.append(button);

  return {
    setRoots(roots) {
      shown = roots.roots.find((r) => r.path === roots.shown);
      const problems = shown?.problems.filter(isProblem) ?? [];
      const label = problems.length === 0 ? "Logs" : `Logs, ${problems.length} ${problems.length === 1 ? "problem" : "problems"}`;
      count.hidden = problems.length === 0;
      count.textContent = String(problems.length);
      count.dataset["tone"] = problems.some((p) => p.severity === "error") ? "error" : "warning";
      button.title = label;
      button.setAttribute("aria-label", label);
    },
  };
}

// Mounts the header's `<file> only` toggle, which builds only the focused included file.

interface OnlyToggleDeps {
  post: (msg: WebviewToHost) => void;
}

/**
 * Mounts the toggle into the header's `only` slot; the slot stays hidden while the shown root offers no `includeOnly`.
 * @returns `setRoots`, which the host's roots messages drive.
 */
export function mountOnlyToggle(slot: HTMLElement, { post }: OnlyToggleDeps): { setRoots(roots: PreviewBuildRoots): void } {
  const button = renderElement("button", { class: "rd-preview-only", type: "button", "aria-pressed": "false" });
  let on = false;
  button.addEventListener("click", () => post({ command: "setIncludeOnly", on: !on }));
  slot.append(button);

  return {
    setRoots(roots) {
      const only = roots.options?.includeOnly;
      slot.hidden = only === undefined;
      if (only === undefined) { return; }
      on = only.on;
      const name = only.file.split("/").pop() ?? only.file;
      button.textContent = `${name} only`;
      button.title = `Build only ${only.file} with \\includeonly. Page numbers and references from the other chapters are kept from their .aux files.`;
      button.setAttribute("aria-pressed", String(on));
    },
  };
}

// Shows the findings of the last pre-submission check in the footer and runs the check again on click.

interface ChecksButtonDeps {
  post: (msg: WebviewToHost) => void;
}

/**
 * Mounts the checks button into the footer's `checks` slot; the slot stays hidden until a check has run.
 * @returns `setRoots`, which the host's roots messages drive.
 */
export function mountChecksButton(slot: HTMLElement, { post }: ChecksButtonDeps): { setRoots(roots: PreviewBuildRoots): void } {
  const button = renderElement("button", { class: "rd-checks", type: "button", title: "Check before submitting" });
  button.addEventListener("click", () => post({ command: "runCommand", id: "checkBeforeSubmitting" }));
  slot.append(button);

  return {
    setRoots({ checks }) {
      slot.hidden = checks === undefined;
      if (checks === undefined) { return; }
      button.replaceChildren(renderElement("span", { class: "rd-checks-count", "data-tone": checks > 0 ? "warning" : "ok" }, String(checks)), ` ${checks === 1 ? "check" : "checks"}`);
    },
  };
}

// Builds the preview header: the Recompile group with its slots on the left, the view controls and the status pill on the right.

export type RecompileState = "current" | "stale" | "building";
type HeaderSlotName = "options" | "only" | "logs";

interface PreviewHeaderDeps {
  post: (msg: WebviewToHost) => void;
  /** The reader's `#status-pill`; it moves into the view group. */
  pill: HTMLElement;
  /** Draws the pages dark (true) or as light paper (false). */
  setPagesDark: (dark: boolean) => void;
}

export interface PreviewHeader {
  element: HTMLElement;
  slots: Record<HeaderSlotName, HTMLElement>;
  setBuild(state: RecompileState): void;
}

const SLOT_NAMES: HeaderSlotName[] = ["options", "only", "logs"];

function pressable(button: HTMLButtonElement, pressed: boolean): void {
  button.setAttribute("aria-pressed", String(pressed));
}

/**
 * Mounts the header's controls; the caller inserts `element` into the shell.
 * @returns the element, its empty slots and the setters the host messages drive.
 */
export function mountPreviewHeader({ post, pill, setPagesDark }: PreviewHeaderDeps): PreviewHeader {
  const recompile = renderElement("button", { class: "rd-btn rd-preview-recompile", type: "button", "data-state": "current" });
  const label = renderElement("span", {}, "Recompile");
  const glyph = renderElement("span", { class: "rd-preview-recompile-icon", html: renderIcon("refresh") });
  recompile.append(glyph, label, renderElement("span", { class: "rd-preview-dot", "aria-hidden": "true" }));
  recompile.addEventListener("click", () => post({ command: "recompile" }));

  const slots = Object.fromEntries(
    SLOT_NAMES.map((name) => [name, renderElement("span", { class: "rd-preview-slot", "data-slot": name, hidden: true })]),
  ) as Record<HeaderSlotName, HTMLElement>;

  const compare = renderReaderIconButton(renderIcon("git-compare"), "Compare");
  const mark = renderReaderIconButton(renderIcon("tag"), "Mark");
  const dark = renderReaderIconButton(renderIcon("contrast"), "Dark PDF");
  compare.addEventListener("click", () => post({ command: "runCommand", id: "compareVersions" }));
  mark.addEventListener("click", () => post({ command: "runCommand", id: "markVersion" }));

  let pagesDark = false;
  pressable(dark, false);
  dark.addEventListener("click", () => {
    pagesDark = !pagesDark;
    pressable(dark, pagesDark);
    setPagesDark(pagesDark);
  });

  const rule = renderElement("span", { class: "rd-preview-rule", "aria-hidden": "true" });
  const build = renderElement("div", { class: "rd-preview-build" }, recompile, slots.options, slots.only, rule, slots.logs);
  const viewRule = renderElement("span", { class: "rd-preview-rule", "aria-hidden": "true" });
  const view = renderElement("div", { class: "rd-preview-view" }, compare, mark, dark, viewRule, pill);
  const element = renderElement("header", { class: "rd-preview-header", role: "toolbar", "aria-label": "Preview" }, build, view);

  return {
    element,
    slots,
    setBuild(state) {
      recompile.dataset["state"] = state;
      if (state === "building") { recompile.setAttribute("aria-busy", "true"); } else { recompile.removeAttribute("aria-busy"); }
      glyph.innerHTML = renderIcon(state === "building" ? "loader" : "refresh");
    },
  };
}

// Gives the preview chrome the open document's outline, its page positions and the jump to an entry.

type Destination = Parameters<ReaderContext["linkService"]["goToDestination"]>[0];

export function createPreviewOutlineSource(ctx: ReaderContext): PreviewOutlineSource {
  return {
    async load() {
      const doc = ctx.pdfDocument;
      let raw: RawOutlineNode[] | null = null;
      try {
        raw = (await doc.getOutline()) as RawOutlineNode[] | null;
      } catch (err) {
        console.warn("LabShelf reader: could not read the PDF outline", err);
      }
      const rows = deriveOutlineRows(raw);
      return { rows, pages: await resolveOutlinePages(doc, rows, () => doc === ctx.pdfDocument) };
    },
    currentPage: () => ctx.pdfViewer.currentPageNumber,
    onPageChange: (fn) => ctx.eventBus.on("pagechanging", fn),
    jump: (row: OutlineRow) => { if (row.dest) { void ctx.linkService.goToDestination(row.dest as Destination); } },
  };
}

// Scrolls the PDF so a page area sits a little below the top of the view.

// PDF points of page kept visible above the area, so the lines before a problem show with it.
const LEAD_IN = 48;

interface PageViewLike {
  viewport?: { viewBox: number[] };
}

/** @returns a function that scrolls to an area given in points from the page's top-left corner. */
export function createAreaScroller(ctx: ReaderContext): (area: PageArea) => void {
  return (area) => {
    const { pdfViewer, pdfDocument } = ctx;
    const pageNumber = deriveClampedPage(area.page, pdfDocument.numPages);
    const viewBox = (pdfViewer.getPageView(pageNumber - 1) as PageViewLike | undefined)?.viewport?.viewBox;
    if (!viewBox) { pdfViewer.scrollPageIntoView({ pageNumber }); return; }
    // PDF user space grows upwards from the box's bottom; the area's `top` counts down from the box's top.
    const top = (viewBox[3] ?? 0) - Math.max(0, area.top - LEAD_IN);
    pdfViewer.scrollPageIntoView({ pageNumber, destArray: [null, { name: "XYZ" }, null, top, null], allowNegativeOffset: true });
  };
}

// Counts the pages of a PDF that hold the paper's body, from the text layer of every page.

/** @returns the pages before the references, or all pages when the PDF has no references heading. */
export async function countBodyPages(document: PDFDocumentProxy): Promise<number> {
  const pages: string[][] = [];
  for (let number = 1; number <= document.numPages; number++) {
    const content = await (await document.getPage(number)).getTextContent();
    // PLATFORM: pdf.js types marked-content entries beside text items; only items carry `str`.
    pages.push(derivePdfTextLines(content.items.filter((item): item is typeof item & PdfTextItem => "str" in item)));
  }
  return derivePaperBody(pages).contentPages;
}
