// Builds the preview header: the Recompile group with its slots on the left, the view controls and the status pill on the right.
import { icon } from "../../../../ui/index.js";
import { el } from "../../../../ui/dom/index.js";
import type { WebviewToHost } from "../../../index.js";
import { iconButton } from "../../elements/index.js";

export type RecompileState = "current" | "stale" | "building";
type HeaderSlotName = "options" | "only" | "logs" | "export";

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

const SLOT_NAMES: HeaderSlotName[] = ["options", "only", "logs", "export"];

function pressable(button: HTMLButtonElement, pressed: boolean): void {
  button.setAttribute("aria-pressed", String(pressed));
}

/**
 * Mounts the header's controls; the caller inserts `element` into the shell.
 * @returns the element, its empty slots and the setters the host messages drive.
 */
export function mountPreviewHeader({ post, pill, setPagesDark }: PreviewHeaderDeps): PreviewHeader {
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
  compare.addEventListener("click", () => post({ command: "runCommand", id: "compareVersions" }));
  mark.addEventListener("click", () => post({ command: "runCommand", id: "markVersion" }));

  let pagesDark = false;
  pressable(dark, false);
  dark.addEventListener("click", () => {
    pagesDark = !pagesDark;
    pressable(dark, pagesDark);
    setPagesDark(pagesDark);
  });

  const rule = el("span", { class: "rd-preview-rule", "aria-hidden": "true" });
  const build = el("div", { class: "rd-preview-build" }, recompile, slots.options, slots.only, rule, slots.logs, slots.export);
  const viewRule = el("span", { class: "rd-preview-rule", "aria-hidden": "true" });
  const view = el("div", { class: "rd-preview-view" }, compare, mark, dark, viewRule, pill);
  const element = el("header", { class: "rd-preview-header", role: "toolbar", "aria-label": "Preview" }, build, view);

  return {
    element,
    slots,
    setBuild(state) {
      recompile.dataset["state"] = state;
      if (state === "building") { recompile.setAttribute("aria-busy", "true"); } else { recompile.removeAttribute("aria-busy"); }
      glyph.innerHTML = icon(state === "building" ? "loader" : "refresh");
    },
  };
}
