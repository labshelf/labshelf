// The workspace's header (mode tabs, build state, format, Export PDF, Present or Real size), its insert toolbar and its status bar.
import { renderElement, renderIcon, showMenu, type IconName, type MenuEntry } from "../../../ui/dom/index.js";
import type { DeckKind, SourceDeckFormat } from "../../index.js";
import type { DeckBuildState, DeckWorkspaceMode } from "./types.js";

const MODES: ReadonlyArray<{ mode: DeckWorkspaceMode; label: string; icon: IconName }> = [
  { mode: "visual", label: "Visual", icon: "eye" }, { mode: "split", label: "Split", icon: "panel-right" }, { mode: "code", label: "Code", icon: "code" },
];

export interface HeaderHooks {
  setMode(mode: DeckWorkspaceMode): void;
  build(): void;
  showProblems(): void;
  exportPdf(): void;
  present(): void;
  posterPreview(): void;
}

export interface Header {
  element: HTMLElement;
  setMode(mode: DeckWorkspaceMode): void;
  setBuild(state: DeckBuildState): void;
}

function labelled(icon: IconName, label: string, className: string, run: (button: HTMLButtonElement) => void): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: className, title: label, html: renderIcon(icon) });
  button.append(renderElement("span", { text: label }));
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => run(button));
  return button;
}

export function createHeader(kind: DeckKind, format: SourceDeckFormat, name: string, hooks: HeaderHooks): Header {
  const tabs = renderElement("div", { class: "dw-modes", role: "tablist", "aria-label": "Mode" });
  const tabButtons = MODES.map(({ mode, label, icon }) => {
    const button = labelled(icon, label, "dw-mode", () => hooks.setMode(mode));
    button.setAttribute("role", "tab");
    button.dataset["mode"] = mode;
    tabs.append(button);
    return button;
  });
  const build = renderElement("button", { type: "button", class: "dw-build", "data-state": "none" });
  build.addEventListener("click", () => { if (build.dataset["state"] === "failed") hooks.showProblems(); else if (build.dataset["state"] !== "building") hooks.build(); });
  const element = renderElement("header", { class: "dw-header" },
    tabs,
    renderElement("span", { class: "dw-title", text: name }),
    renderElement("span", { class: "dw-spacer" }),
    build,
    renderElement("span", { class: "dw-badge", text: format === "latex" ? "LaTeX" : "Typst" }),
    labelled("download", "Export PDF", "dw-header-button", () => hooks.exportPdf()),
    kind === "talk" ? labelled("play", "Present", "dw-header-button dw-primary", () => hooks.present()) : labelled("eye", "Real size", "dw-header-button dw-primary", () => hooks.posterPreview()));
  return {
    element,
    setMode(mode) { for (const button of tabButtons) button.setAttribute("aria-selected", String(button.dataset["mode"] === mode)); },
    setBuild({ state, errors }) {
      build.dataset["state"] = state;
      const [icon, text, title] = state === "building" ? ["loader", "Compiling…", "The build is running"] as const
        : state === "failed" ? ["warning", errors > 0 ? `Errors (${errors})` : "Build failed", "Show the build's problems"] as const
          : state === "succeeded" ? ["check", "Updated", "Build again"] as const
            : ["refresh", "Build", "Build the PDF"] as const;
      build.innerHTML = renderIcon(icon);
      build.append(renderElement("span", { text }));
      build.title = title;
    },
  };
}

/** One insert toolbar entry: a button, or a menu built when pressed; `disabled` gives the reason it is off. */
export interface InsertItem { icon: IconName; label: string; run?(): void; menu?(): MenuEntry[]; disabled?(): string | undefined }

/** The insert toolbar: groups of labelled buttons and menus, and `end` items at the right end. */
export function createInsertBar(groups: ReadonlyArray<readonly InsertItem[]>, end: readonly HTMLElement[] = []): { element: HTMLElement; refresh(): void } {
  const buttons: Array<{ button: HTMLButtonElement; item: InsertItem }> = [];
  const element = renderElement("div", { class: "dw-insertbar", role: "toolbar", "aria-label": "Insert" });
  for (const group of groups) {
    const section = renderElement("div", { class: "dw-insert-group" });
    for (const item of group) {
      const button = labelled(item.icon, item.label, "dw-insert", (self) => {
        if (item.menu) showMenu(self, item.menu()); else item.run?.();
      });
      if (item.menu) button.insertAdjacentHTML("beforeend", renderIcon("chevron-down"));
      buttons.push({ button, item });
      section.append(button);
    }
    element.append(section);
  }
  element.append(renderElement("span", { class: "dw-spacer" }), ...end);
  const refresh = (): void => {
    for (const { button, item } of buttons) {
      const reason = item.disabled?.();
      button.disabled = reason !== undefined;
      button.title = reason ?? item.label;
    }
  };
  return { element, refresh };
}

export interface StatusBar {
  element: HTMLElement;
  set(parts: { left: string; crumb: string[]; nav?: { previous(): void; next(): void; canPrevious: boolean; canNext: boolean } }): void;
}

export function createStatusBar(): StatusBar {
  const left = renderElement("span", { class: "dw-status-left" });
  const previous = renderElement("button", { type: "button", class: "dw-tool", title: "Previous slide", "aria-label": "Previous slide", html: renderIcon("chevron-left") });
  const next = renderElement("button", { type: "button", class: "dw-tool", title: "Next slide", "aria-label": "Next slide", html: renderIcon("chevron-right") });
  const crumb = renderElement("span", { class: "dw-crumb" });
  const element = renderElement("footer", { class: "dw-status" }, previous, left, next, renderElement("span", { class: "dw-spacer" }), crumb);
  let nav: Parameters<StatusBar["set"]>[0]["nav"];
  previous.addEventListener("click", () => nav?.previous());
  next.addEventListener("click", () => nav?.next());
  return {
    element,
    set(parts) {
      nav = parts.nav;
      left.textContent = parts.left;
      previous.hidden = next.hidden = !nav;
      previous.disabled = !nav?.canPrevious;
      next.disabled = !nav?.canNext;
      crumb.replaceChildren(...parts.crumb.flatMap((part, i) => [...(i ? [renderElement("span", { class: "dw-crumb-sep", html: renderIcon("chevron-right") })] : []), renderElement("span", { text: part })]));
    },
  };
}
