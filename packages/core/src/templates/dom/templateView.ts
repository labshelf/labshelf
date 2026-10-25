// Presents a template preview with project creation and source details.
import { renderIcon } from "../../ui/index.js";
import { renderElement } from "../../ui/dom/index.js";
import type { TemplateEntry } from "../templateEntry.js";
import { CATEGORY_LABELS, distinctEngineLabel, FORMAT_LABELS, templateByLine, templateUsesCount } from "../templateLabels.js";
import { fillThumb } from "./templateCard.js";

export interface TemplateDetailOptions {
  entry: TemplateEntry;
  thumbnail: string | undefined;
  problem: string | undefined;
  busy: boolean;
  onBack(): void;
  onUse(): void;
}

export interface TemplateDetail {
  element: HTMLElement;
  setProblem(problem: string | undefined): void;
  setBusy(busy: boolean): void;
  setThumbnail(dataUri: string | undefined): void;
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
  const dl = renderElement("dl", { class: "ls-tpl-meta" });
  for (const [label, value] of metaRows(entry)) {
    dl.append(renderElement("dt", { text: label }), renderElement("dd", { text: value, title: value }));
  }
  return dl;
}

function orderedFiles(entry: TemplateEntry, files: string[]): string[] {
  const rest = files.filter((path) => path !== entry.main).sort();
  return files.includes(entry.main) ? [entry.main, ...rest] : rest;
}

function renderFiles(entry: TemplateEntry, files: string[]): HTMLElement {
  const list = renderElement("ul", { class: "ls-tpl-files", "aria-label": "Files" });
  for (const path of orderedFiles(entry, files)) {
    list.append(renderElement("li", {},
      renderElement("span", { class: "ls-tpl-file-icon", html: renderIcon(path.endsWith("/") ? "folder" : "file") }),
      renderElement("span", { class: "ls-tpl-file-path", text: path, title: path })));
  }
  return renderElement("div", { class: "ls-tpl-files-block" }, renderElement("div", { class: "ls-tpl-section", text: "Files" }), list);
}

function renderWarning(problem: string): HTMLElement {
  return renderElement("div", { class: "ls-tpl-engine", role: "note" },
    renderElement("span", { class: "ls-tpl-engine-icon", html: renderIcon("warning") }),
    renderElement("span", { text: problem }));
}

function fillUseButton(button: HTMLButtonElement, busy: boolean): void {
  button.disabled = busy;
  if (busy) button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
  button.replaceChildren(
    ...(busy ? [renderElement("span", { class: "spin", html: renderIcon("loader") })] : []),
    renderElement("span", { text: busy ? "Creating project…" : "Use template" }));
}

export function renderTemplateDetail(options: TemplateDetailOptions): TemplateDetail {
  const { entry } = options;
  const by = templateByLine(entry);
  const headingId = `ls-tpl-detail-title-${nextHeadingId++}`;
  const heading = renderElement("h1", { id: headingId, class: "ls-tpl-detail-title", tabindex: -1, text: entry.name, title: entry.name });
  const back = renderElement("button", { class: "ls-btn", type: "button" }, renderElement("span", { html: renderIcon("arrow-left") }), "Templates");
  const preview = renderElement("figure", { class: "ls-tpl-preview" });
  const use = renderElement("button", { class: "ls-btn ls-btn-primary ls-btn-lg", type: "button" });
  const warningSlot = renderElement("div", { class: "ls-tpl-engine-slot" });
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

  const info = renderElement("div", { class: "ls-tpl-info" },
    renderElement("div", { class: "ls-tpl-detail-heading" }, heading,
      renderElement("div", { class: "ls-tpl-card-by", text: by, title: by }),
      renderElement("p", { class: "ls-tpl-description", text: entry.description })),
    use, warningSlot, renderMeta(entry),
    entry.files ? renderFiles(entry, entry.files) : null);
  const element = renderElement("section", { class: "ls-tpl-detail", "aria-labelledby": headingId },
    renderElement("div", { class: "ls-tpl-detail-nav" }, back),
    renderElement("div", { class: "ls-tpl-detail-body" }, preview, info));

  return { element, setProblem, setBusy, setThumbnail, focus: () => heading.focus(), dispose: () => element.remove() };
}
