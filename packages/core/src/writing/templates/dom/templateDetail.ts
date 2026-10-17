// Renders the detail page of one template: preview, description, Use button, engine warning, metadata and files.
import { icon } from "../../../ui/index.js";
import { el } from "../../../ui/dom/index.js";
import type { TemplateEntry } from "../templateEntry.js";
import { CATEGORY_LABELS, distinctEngineLabel, FORMAT_LABELS, templateByLine, templateUsesCount } from "../templateLabels.js";
import { fillThumb } from "./templateCard.js";

export interface TemplateDetailOptions {
  entry: TemplateEntry;
  thumbnail: string | undefined;
  /** The engine problem already known for this template, shown as a warning. */
  problem: string | undefined;
  busy: boolean;
  onBack(): void;
  onUse(): void;
}

export interface TemplateDetail {
  element: HTMLElement;
  /** Shows the engine warning with this text, or removes it when there is none. */
  setProblem(problem: string | undefined): void;
  setBusy(busy: boolean): void;
  setThumbnail(dataUri: string | undefined): void;
  /** Moves focus to the heading, the page's accessible name. */
  focus(): void;
  dispose(): void;
}

let nextHeadingId = 0;

function metaRows(entry: TemplateEntry): Array<[string, string]> {
  const engine = distinctEngineLabel(entry);
  const rows: Array<[string, string]> = [["Format", FORMAT_LABELS[entry.format]]];
  if (engine) rows.push(["Engine", engine]);
  rows.push(["Category", CATEGORY_LABELS[entry.category]], ["License", entry.license]);
  if (entry.version) rows.push(["Version", entry.version]);
  if (entry.compiler) rows.push(["Needs Typst", `${entry.compiler} or later`]);
  const uses = templateUsesCount(entry);
  if (uses !== undefined) rows.push(["Uses", uses]);
  return rows;
}

function renderMeta(entry: TemplateEntry): HTMLElement {
  const dl = el("dl", { class: "ls-tpl-meta" });
  for (const [label, value] of metaRows(entry)) {
    dl.append(el("dt", { text: label }), el("dd", { text: value, title: value }));
  }
  return dl;
}

/** Lists `entry.main` first, then the other paths sorted. */
function orderedFiles(entry: TemplateEntry, files: string[]): string[] {
  const rest = files.filter((path) => path !== entry.main).sort();
  return files.includes(entry.main) ? [entry.main, ...rest] : rest;
}

function renderFiles(entry: TemplateEntry, files: string[]): HTMLElement {
  const list = el("ul", { class: "ls-tpl-files", "aria-label": "Files" });
  for (const path of orderedFiles(entry, files)) {
    list.append(el("li", {},
      el("span", { class: "ls-tpl-file-icon", html: icon(path.endsWith("/") ? "folder" : "file") }),
      el("span", { class: "ls-tpl-file-path", text: path, title: path })));
  }
  return el("div", { class: "ls-tpl-files-block" }, el("div", { class: "ls-tpl-section", text: "Files" }), list);
}

function renderWarning(problem: string): HTMLElement {
  return el("div", { class: "ls-tpl-engine", role: "note" },
    el("span", { class: "ls-tpl-engine-icon", html: icon("warning") }),
    el("span", { text: problem }));
}

function fillUseButton(button: HTMLButtonElement, busy: boolean): void {
  button.disabled = busy;
  if (busy) button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
  button.replaceChildren(
    ...(busy ? [el("span", { class: "spin", html: icon("loader") })] : []),
    el("span", { text: busy ? "Creating project…" : "Use template" }));
}

export function renderTemplateDetail(options: TemplateDetailOptions): TemplateDetail {
  const { entry } = options;
  const by = templateByLine(entry);
  const headingId = `ls-tpl-detail-title-${nextHeadingId++}`;
  const heading = el("h1", { id: headingId, class: "ls-tpl-detail-title", tabindex: -1, text: entry.name, title: entry.name });
  const back = el("button", { class: "ls-btn", type: "button" }, el("span", { html: icon("arrow-left") }), "Templates");
  const preview = el("figure", { class: "ls-tpl-preview" });
  const use = el("button", { class: "ls-btn ls-btn-primary ls-btn-lg", type: "button" });
  const warningSlot = el("div", { class: "ls-tpl-engine-slot" });
  back.addEventListener("click", options.onBack);
  use.addEventListener("click", options.onUse);

  const setThumbnail = (dataUri: string | undefined): void =>
    fillThumb(preview, dataUri, `First page of the ${entry.name} template`);
  const setProblem = (problem: string | undefined): void =>
    warningSlot.replaceChildren(...(problem ? [renderWarning(problem)] : []));
  const setBusy = (busy: boolean): void => fillUseButton(use, busy);
  setThumbnail(options.thumbnail);
  setProblem(options.problem);
  setBusy(options.busy);

  const info = el("div", { class: "ls-tpl-info" },
    heading,
    el("div", { class: "ls-tpl-card-by", text: by, title: by }),
    el("p", { class: "ls-tpl-description", text: entry.description }),
    use, warningSlot, renderMeta(entry),
    entry.files ? renderFiles(entry, entry.files) : null);
  const element = el("section", { class: "ls-tpl-detail", "aria-labelledby": headingId },
    el("div", { class: "ls-tpl-detail-nav" }, back),
    el("div", { class: "ls-tpl-detail-body" }, preview, info));

  return { element, setProblem, setBusy, setThumbnail, focus: () => heading.focus(), dispose: () => element.remove() };
}
