// The workspace shell: a header (back, breadcrumb, a centre slot, the save state, Code and the primary action), a left panel,
// the centre column (toolbar, stage, an optional bottom panel), the inspector (title, tabs, body) and the status bar.
import { renderElement } from "./dom.js";
import { renderIcon, type IconName } from "../icons/index.js";
import { wsButton, setPressed } from "./workspaceControls.js";

export type WsSaveTone = "saved" | "local" | "error";

export interface WsShellOptions {
  back: { label: string; run(): void };
  crumbs: readonly string[];
  code?: { label: string; run(): void };
  primary: { label: string; run(): void };
}

export interface WsInspectorView {
  title: string;
  icon?: IconName;
  swatch?: string;
  tabs?: readonly { id: string; label: string }[];
  tab?: string;
  onTab?(id: string): void;
  onClose?(): void;
}

export interface WsInspector { element: HTMLElement; body: HTMLElement; show(view: WsInspectorView): void; empty(text: string): void }

export interface WsShell {
  root: HTMLElement;
  setCrumbs(crumbs: readonly string[]): void;
  setCenter(element: HTMLElement | null): void;
  setSave(text: string, tone: WsSaveTone): void;
  setCode(open: boolean): void;
  primary: HTMLButtonElement;
  left: HTMLElement;
  toolbar: HTMLElement;
  stage: HTMLElement;
  bottom: HTMLElement;
  inspector: WsInspector;
  status: { left: HTMLElement; center: HTMLElement; right: HTMLElement };
}

/** The inspector: a title row with its icon or swatch and close, a tab strip, and the body the mode fills. A mode may also show one of its own elsewhere (a floating panel). */
export function createWsInspector(): WsInspector {
  const head = renderElement("div", { class: "ws-inspector-head" });
  const tabs = renderElement("div", { class: "ws-tabs", role: "tablist" });
  const body = renderElement("div", { class: "ws-inspector-body" });
  const element = renderElement("aside", { class: "ws-inspector", "aria-label": "Properties" }, head, tabs, body);
  const show = (view: WsInspectorView): void => {
    const mark = view.swatch ? renderElement("span", { class: "ws-dot ws-dot-lg", style: `background:${view.swatch}` }) : view.icon ? renderElement("span", { class: "ws-icon", html: renderIcon(view.icon) }) : null;
    const close = view.onClose ? wsButton({ icon: "close", label: "Close" }, () => view.onClose!()) : null;
    head.replaceChildren(mark ?? "", renderElement("h2", { class: "ws-inspector-title", text: view.title }), renderElement("span", { class: "ws-spacer" }), close ?? "");
    tabs.replaceChildren(...(view.tabs ?? []).map((tab) => {
      const button = renderElement("button", { type: "button", role: "tab", class: "ws-tab", "aria-selected": String(tab.id === view.tab), text: tab.label });
      button.addEventListener("click", () => view.onTab?.(tab.id));
      return button;
    }));
    tabs.hidden = (view.tabs ?? []).length === 0;
  };
  const empty = (text: string): void => { head.replaceChildren(); tabs.hidden = true; body.replaceChildren(renderElement("p", { class: "ws-empty", text })); };
  return { element, body, show, empty };
}

/** The header: back, the breadcrumb, a centre slot, the save state, Code and the primary action. */
function createHeader(options: WsShellOptions): { element: HTMLElement; crumbs: HTMLElement; center: HTMLElement; save: HTMLElement; code: HTMLButtonElement | null; primary: HTMLButtonElement } {
  const crumbs = renderElement("nav", { class: "ws-crumbs", "aria-label": "Breadcrumb" });
  const center = renderElement("div", { class: "ws-header-center" });
  const save = renderElement("span", { class: "ws-save", "data-tone": "saved" });
  const code = options.code ? wsButton({ icon: "vs-code", label: options.code.label, showLabel: true }, () => options.code!.run(), { variant: "outline", pressed: false }) : null;
  const primary = wsButton({ label: options.primary.label }, () => options.primary.run(), { variant: "primary" });
  const back = wsButton({ icon: "arrow-left", label: options.back.label, showLabel: true }, () => options.back.run(), { extra: "ws-back" });
  const element = renderElement("header", { class: "ws-header" }, back, renderElement("span", { class: "ws-divider" }), crumbs, center, renderElement("span", { class: "ws-spacer" }), save, code, primary);
  return { element, crumbs, center, save, code, primary };
}

/** Builds the shell; the caller fills the panels and the status bar. */
export function createWorkspaceShell(options: WsShellOptions): WsShell {
  const header = createHeader(options);
  const left = renderElement("aside", { class: "ws-left" });
  const toolbar = renderElement("div", { class: "ws-toolbar", role: "toolbar" });
  const stage = renderElement("div", { class: "ws-stage" });
  const bottom = renderElement("div", { class: "ws-bottom" });
  bottom.hidden = true;
  const inspector = createWsInspector();
  const status = { left: renderElement("div", { class: "ws-status-left" }), center: renderElement("div", { class: "ws-status-center" }), right: renderElement("div", { class: "ws-status-right" }) };
  const root = renderElement("div", { class: "ws" },
    header.element,
    renderElement("div", { class: "ws-body" }, left, renderElement("main", { class: "ws-center" }, toolbar, stage, bottom), inspector.element),
    renderElement("footer", { class: "ws-status" }, status.left, status.center, status.right));
  const setCrumbs = (crumbs: readonly string[]): void => {
    header.crumbs.replaceChildren(...crumbs.flatMap((crumb, i) => [...(i > 0 ? [renderElement("span", { class: "ws-crumb-sep", text: "/" })] : []), renderElement("span", { class: "ws-crumb", text: crumb })]));
  };
  setCrumbs(options.crumbs);
  return {
    root, setCrumbs, primary: header.primary, left, toolbar, stage, bottom, inspector, status,
    setCenter: (element) => header.center.replaceChildren(element ?? ""),
    setSave(text, tone) { header.save.textContent = text; header.save.dataset["tone"] = tone; },
    setCode(open) { if (header.code) setPressed(header.code, open); },
  };
}
