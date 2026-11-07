// The shell's header: mode tabs, title and badge, the saved indicator, the build button, Export and the show button.
import { renderElement, renderIcon, showMenu, type IconName } from "../../../ui/dom/index.js";
import { shellButton } from "./insertBar.js";
import type { DeckShellMode, ShellHeader, ShellHeaderSpec } from "./types.js";

const MODES: Record<DeckShellMode, { label: string; icon: IconName }> = {
  visual: { label: "Visual", icon: "eye" }, split: { label: "Split", icon: "panel-right" }, code: { label: "Code", icon: "code" },
};

const BUILD = {
  none: ["refresh", "Build", "Build the PDF"],
  building: ["loader", "Compiling…", "The build is running"],
  succeeded: ["check", "Updated", "Build again"],
  failed: ["warning", "Build failed", "Show the build's problems"],
} as const;

function exportControl(exports: NonNullable<ShellHeaderSpec["exports"]>): HTMLElement[] {
  if (exports.length === 0) return [];
  if (exports.length === 1) {
    const [only] = exports;
    return [shellButton(only!.icon, `Export ${only!.label}`, "dw-header-button", () => only!.run())];
  }
  return [shellButton("download", "Export", "dw-header-button", (button) => showMenu(button, exports.map((entry) => ({ label: entry.label, icon: entry.icon, onSelect: () => entry.run() }))))];
}

/** The build button, wired to the hooks; undefined when the shell has no build step. */
function buildButton(hooks: ShellHeaderSpec["build"]): HTMLElement | undefined {
  if (!hooks) return undefined;
  const build = renderElement("button", { type: "button", class: "dw-build", "data-state": "none" });
  build.addEventListener("mousedown", (event) => event.preventDefault());
  build.addEventListener("click", () => {
    if (build.dataset["state"] === "failed") hooks.showProblems(); else if (build.dataset["state"] !== "building") hooks.run();
  });
  return build;
}

export function createShellHeader(spec: ShellHeaderSpec): ShellHeader {
  const modes = spec.modes ?? [];
  const tabButtons = modes.length >= 2
    ? modes.map((mode) => {
      const button = shellButton(MODES[mode].icon, MODES[mode].label, "dw-mode", () => spec.onMode?.(mode));
      button.setAttribute("role", "tab");
      button.dataset["mode"] = mode;
      return button;
    })
    : [];
  const tabs = tabButtons.length > 0 ? [renderElement("div", { class: "dw-modes", role: "tablist", "aria-label": "Mode" }, ...tabButtons)] : [];
  const saved = spec.saved === undefined ? undefined : renderElement("span", { class: "dw-check dw-saved" });
  const build = buildButton(spec.build);
  const setSaved = (next: boolean): void => {
    if (!saved) return;
    saved.dataset["saved"] = String(next);
    saved.textContent = next ? "Saved" : "Unsaved changes";
  };
  const setBuild: ShellHeader["setBuild"] = ({ state, errors }) => {
    if (!build) return;
    build.dataset["state"] = state;
    const [icon, text, title] = BUILD[state];
    build.innerHTML = renderIcon(icon);
    build.append(renderElement("span", { text: state === "failed" && errors > 0 ? `Errors (${errors})` : text }));
    build.title = title;
  };
  const element = renderElement("header", { class: "dw-header" },
    ...tabs,
    renderElement("span", { class: "dw-title", text: spec.title }),
    renderElement("span", { class: "dw-badge", text: spec.badge }),
    renderElement("span", { class: "dw-spacer" }),
    ...(saved ? [saved] : []),
    ...(build ? [build] : []),
    ...exportControl(spec.exports ?? []),
    ...(spec.show ? [shellButton(spec.show.icon, spec.show.label, "dw-header-button dw-primary", () => spec.show!.run())] : []));
  if (spec.saved !== undefined) setSaved(spec.saved);
  setBuild({ state: "none", errors: 0 });
  return {
    element,
    setMode(mode) { for (const button of tabButtons) button.setAttribute("aria-selected", String(button.dataset["mode"] === mode)); },
    setBuild,
    setSaved,
  };
}
