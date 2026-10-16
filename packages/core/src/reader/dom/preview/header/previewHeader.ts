// Builds the preview header: the Recompile group with its slots on the left, the view controls and the status pill on the right.
import { icon } from "../../../../ui/index.js";
import { el } from "../../../../ui/dom/index.js";
import type { WebviewToHost } from "../../../index.js";
import { iconButton } from "../../elements/index.js";

export type RecompileState = "current" | "stale" | "building";
type HeaderSlotName = "options" | "only" | "logs" | "export";

interface PreviewHeaderDeps {
  post: (msg: WebviewToHost) => void;
  find: { readonly isOpen: boolean; show(): void; close(): void; onToggle(fn: (open: boolean) => void): void };
  sidebar: { readonly isOpen: boolean; toggle(): void; onChange(fn: (s: { open: boolean }) => void): void };
  /** The reader's `#status-pill`; it moves into the view group. */
  pill: HTMLElement;
}

export interface PreviewHeader {
  element: HTMLElement;
  slots: Record<HeaderSlotName, HTMLElement>;
  setBuild(state: RecompileState): void;
  /** Follows the host's effective theme; Dark PDF is pressed while it is dark. */
  setDark(dark: boolean): void;
}

const SLOT_NAMES: HeaderSlotName[] = ["options", "only", "logs", "export"];

function pressable(button: HTMLButtonElement, pressed: boolean): void {
  button.setAttribute("aria-pressed", String(pressed));
}

/**
 * Mounts the header's controls; the caller inserts `element` into the shell.
 * @returns the element, its empty slots and the setters the host messages drive.
 */
export function mountPreviewHeader({ post, find, sidebar, pill }: PreviewHeaderDeps): PreviewHeader {
  const recompile = el("button", { class: "rd-btn rd-preview-recompile", type: "button", "data-state": "current" });
  const label = el("span", {}, "Recompile");
  const glyph = el("span", { class: "rd-preview-recompile-icon", html: icon("refresh") });
  recompile.append(glyph, label, el("span", { class: "rd-preview-dot", "aria-hidden": "true" }));
  recompile.addEventListener("click", () => post({ command: "recompile" }));

  const slots = Object.fromEntries(
    SLOT_NAMES.map((name) => [name, el("span", { class: "rd-preview-slot", "data-slot": name, hidden: true })]),
  ) as Record<HeaderSlotName, HTMLElement>;

  const compare = iconButton(icon("git-compare"), "Compare");
  const mark = iconButton(icon("tag"), "Mark");
  const dark = iconButton(icon("contrast"), "Dark PDF");
  const findButton = iconButton(icon("search"), "Find");
  const sidebarButton = iconButton(icon("panel-left"), "Sidebar");
  compare.addEventListener("click", () => post({ command: "runCommand", id: "compareVersions" }));
  mark.addEventListener("click", () => post({ command: "runCommand", id: "markVersion" }));

  let isDark = false;
  pressable(dark, false);
  dark.addEventListener("click", () => post({ command: "selectTheme", theme: isDark ? "light" : "dark" }));

  pressable(findButton, find.isOpen);
  findButton.addEventListener("click", () => (find.isOpen ? find.close() : find.show()));
  find.onToggle((open) => pressable(findButton, open));
  pressable(sidebarButton, sidebar.isOpen);
  sidebarButton.addEventListener("click", () => sidebar.toggle());
  sidebar.onChange((s) => pressable(sidebarButton, s.open));

  const build = el("div", { class: "rd-preview-build" }, recompile, ...SLOT_NAMES.map((n) => slots[n]));
  const view = el("div", { class: "rd-preview-view" }, compare, mark, dark, findButton, sidebarButton, pill);
  const element = el("header", { class: "rd-preview-header", role: "toolbar", "aria-label": "Preview" }, build, view);

  return {
    element,
    slots,
    setBuild(state) {
      recompile.dataset["state"] = state;
      if (state === "building") { recompile.setAttribute("aria-busy", "true"); } else { recompile.removeAttribute("aria-busy"); }
      glyph.innerHTML = icon(state === "building" ? "loader" : "refresh");
    },
    setDark(value) {
      isDark = value;
      pressable(dark, value);
    },
  };
}
