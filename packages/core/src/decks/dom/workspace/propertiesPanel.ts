// The workspace's right panel: the selected node's properties in Content and Style tabs, each written to the source on change or release,
// its source as Block code with Open in code; and the floating action bar over the selection on the stage.
import { renderElement, renderIcon, type IconName } from "../../../ui/dom/index.js";
import { describeSourceDeckNode, type SourceDeckAlign, type SourceDeckNode, type SourceDeckPropName } from "../../index.js";

export type NodeAction = "up" | "down" | "duplicate" | "delete" | "code";

export interface PropertiesHooks {
  write(prop: SourceDeckPropName, value: string | number): void;
  action(action: NodeAction): void;
  /** Picks a new image for a figure; absent, the path is edited as text. */
  replaceImage?(): void;
  /** How many columns the poster has, for the Column menu. */
  columns(): number;
}

export interface PropertiesPanel {
  element: HTMLElement;
  /** Shows the node's properties; `column` is the index of a poster block's column. */
  render(node: SourceDeckNode | undefined, context: { index: number; column?: number; source: string; breadcrumb: string[] }): void;
}

const NODE_KINDS: Record<SourceDeckNode["kind"], string> = {
  column: "Column", block: "Block", slide: "Slide", figure: "Figure", equation: "Equation", list: "List", table: "Table", columns: "Columns", text: "Text", code: "Code",
};
const ALIGNS: ReadonlyArray<{ value: SourceDeckAlign; label: string }> = [{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }];
const MAX_CODE_LINES = 24;

function field(label: string, control: HTMLElement): HTMLElement {
  return renderElement("label", { class: "dw-field" }, renderElement("span", { class: "dw-field-label", text: label }), control);
}

/** A text input that writes on Enter or when it loses focus with a changed value. */
function textInput(value: string, write: (value: string) => void): HTMLInputElement {
  const input = renderElement("input", { type: "text", class: "dw-input", value });
  const commit = (): void => { if (input.value !== value) write(input.value); };
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") input.blur(); });
  return input;
}

/** A 10–100% slider of a fraction that writes when released. */
function fractionSlider(value: number, write: (value: number) => void): HTMLElement {
  const input = renderElement("input", { type: "range", class: "dw-range", min: "10", max: "100", step: "1", value: String(Math.round(value * 100)) });
  const shown = renderElement("span", { class: "dw-range-value", text: `${Math.round(value * 100)}%` });
  input.addEventListener("input", () => { shown.textContent = `${input.value}%`; });
  input.addEventListener("change", () => write(Number(input.value) / 100));
  return renderElement("span", { class: "dw-range-row" }, input, shown);
}

function segmented(current: SourceDeckAlign | undefined, write: (value: SourceDeckAlign) => void): HTMLElement {
  const group = renderElement("span", { class: "dw-segmented", role: "radiogroup" });
  for (const { value, label } of ALIGNS) {
    const button = renderElement("button", { type: "button", role: "radio", "aria-checked": String(current === value), text: label });
    button.addEventListener("click", () => write(value));
    group.append(button);
  }
  return group;
}

/** A floating-bar icon button that keeps the focus where it was. */
export function actionButton(icon: IconName, label: string, run: () => void, extra = ""): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: `dw-action ${extra}`.trim(), title: label, "aria-label": label, html: renderIcon(icon) });
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", run);
  return button;
}

/** Content tab: title, image path, caption and the block's code. */
function contentTab(hooks: PropertiesHooks, node: SourceDeckNode, source: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (node.titleRange) out.push(field("Title", textInput(node.title ?? "", (value) => hooks.write("title", value))));
  if (node.props.src !== undefined) {
    const path = textInput(node.props.src, (value) => hooks.write("src", value));
    const replace = hooks.replaceImage ? renderElement("button", { type: "button", class: "dw-button", text: "Replace…" }) : undefined;
    replace?.addEventListener("click", () => hooks.replaceImage?.());
    out.push(field("Figure", renderElement("span", { class: "dw-input-row" }, path, ...(replace ? [replace] : []))));
  }
  if (node.props.caption !== undefined) out.push(field("Caption", textInput(node.props.caption, (value) => hooks.write("caption", value))));
  if (node.kind === "code") out.push(renderElement("p", { class: "dw-props-note", text: "LabShelf does not know this LaTeX or Typst form, so it is edited as code." }));
  const lines = source.split("\n");
  const code = renderElement("pre", { class: "dw-code-snippet", text: lines.slice(0, MAX_CODE_LINES).join("\n") + (lines.length > MAX_CODE_LINES ? "\n…" : "") });
  const open = renderElement("button", { type: "button", class: "dw-button", html: renderIcon("code") });
  open.append(renderElement("span", { text: "Open in code" }));
  open.addEventListener("click", () => hooks.action("code"));
  out.push(renderElement("div", { class: "dw-field" }, renderElement("span", { class: "dw-field-label", text: "Block code" }), code, open));
  return out;
}

/** The Column menu of a poster block. */
function columnField(hooks: PropertiesHooks, column: number): HTMLElement {
  const select = renderElement("select", { class: "dw-input" });
  for (let c = 0; c < hooks.columns(); c++) select.append(renderElement("option", { value: String(c), text: `Column ${c + 1}`, ...(c === column ? { selected: true } : {}) }));
  select.addEventListener("change", () => hooks.write("column", Number(select.value)));
  return field("Column", select);
}

/** Style tab: width, alignment, column and column width. */
function styleTab(hooks: PropertiesHooks, node: SourceDeckNode, column: number | undefined): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (node.props.width !== undefined) out.push(field("Width", fractionSlider(node.props.width, (value) => hooks.write("width", value))));
  if (node.kind === "figure" || node.kind === "text") out.push(field("Alignment", segmented(node.props.align, (value) => hooks.write("align", value))));
  if (node.kind === "block" && column !== undefined && hooks.columns() > 1) out.push(columnField(hooks, column));
  if (node.props.columnWidth !== undefined) out.push(field("Column width", fractionSlider(node.props.columnWidth, (value) => hooks.write("columnWidth", value))));
  if (out.length === 0) out.push(renderElement("p", { class: "dw-props-note", text: "This element has no style LabShelf can change here. Edit it in code." }));
  return out;
}

/** What one properties panel keeps between renders. */
interface PanelState {
  hooks: PropertiesHooks;
  tab: "content" | "style";
  tabs: HTMLElement;
  body: HTMLElement;
  title: HTMLElement;
  crumb: HTMLElement;
  last: Parameters<PropertiesPanel["render"]> | undefined;
}

function drawPanel(ps: PanelState): void {
  if (!ps.last) return;
  const [node, context] = ps.last;
  ps.tabs.replaceChildren();
  if (!node) {
    ps.title.textContent = "Nothing selected";
    ps.crumb.textContent = "";
    ps.body.replaceChildren(renderElement("p", { class: "dw-props-note", text: "Click a block on the page or in the structure to edit it." }));
    return;
  }
  ps.title.replaceChildren(renderElement("span", { class: "dw-props-kind", text: NODE_KINDS[node.kind] }), renderElement("span", { text: describeSourceDeckNode(node, context.index) }));
  ps.crumb.textContent = context.breadcrumb.join(" › ");
  const known = node.kind !== "code";
  for (const name of known ? (["content", "style"] as const) : (["content"] as const)) {
    const button = renderElement("button", { type: "button", role: "tab", "aria-selected": String(ps.tab === name), text: name === "content" ? "Content" : "Style" });
    button.addEventListener("click", () => { ps.tab = name; drawPanel(ps); });
    ps.tabs.append(button);
  }
  const parts = ps.tab === "style" && known ? styleTab(ps.hooks, node, context.column) : contentTab(ps.hooks, node, context.source);
  ps.body.replaceChildren(...parts);
}

export function createPropertiesPanel(hooks: PropertiesHooks): PropertiesPanel {
  const tabs = renderElement("div", { class: "dw-tabs", role: "tablist" });
  const body = renderElement("div", { class: "dw-props-body" });
  const title = renderElement("div", { class: "dw-props-title" });
  const crumb = renderElement("div", { class: "dw-props-crumb" });
  const element = renderElement("aside", { class: "dw-props", "aria-label": "Properties" }, title, crumb, tabs, body);
  const ps: PanelState = { hooks, tab: "content", tabs, body, title, crumb, last: undefined };

  return {
    element,
    render(node, context) {
      // Keep focus in a field being typed in when the same node re-renders after its own edit.
      if (element.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement && document.activeElement.type === "text" && ps.last?.[0]?.range[0] === node?.range[0]) { ps.last = [node, context]; return; }
      ps.last = [node, context];
      drawPanel(ps);
    },
  };
}
