// Renders the build status line, with a button to the logs when there are any, and keeps its age text current.
import { icon } from "../../../../ui/index.js";
import { el } from "../../../../ui/dom/index.js";
import type { PreviewRoots } from "../../../index.js";
import { buildStatusText, type PreviewBuildStatus } from "./buildStateText.js";

const CLOCK_MS = 30_000;

export interface StatusViewDeps {
  openLogs: (root: string) => void;
  /** The clock the status ages against. */
  now: () => number;
}

export interface StatusView {
  element: HTMLElement;
  render(roots: PreviewRoots | null, build: PreviewBuildStatus): void;
}

export function createStatusView({ openLogs, now }: StatusViewDeps): StatusView {
  const element = el("div", { class: "rd-preview-status", role: "status", "aria-live": "polite" });
  let clock: ReturnType<typeof setInterval> | null = null;
  let latest: { roots: PreviewRoots | null; build: PreviewBuildStatus } | null = null;

  function render(roots: PreviewRoots | null, build: PreviewBuildStatus): void {
    latest = { roots, build };
    const { text, tone, logsRoot, timed } = buildStatusText(roots, build, now());
    element.dataset["tone"] = tone;
    const glyph = tone === "error" ? "warning" : null;
    const label = el("span", { class: "rd-preview-status-text" }, text);
    const lead = glyph
      ? el("span", { class: "rd-preview-status-icon", "aria-hidden": "true", html: icon(glyph) })
      : el("span", { class: "rd-preview-status-dot", "aria-hidden": "true" });
    const content = text === "" ? [label] : [lead, label];
    if (logsRoot === undefined) {
      element.replaceChildren(...content);
    } else {
      const button = el("button", { class: "rd-preview-status-button", type: "button", title: "Open the build logs" }, ...content);
      button.addEventListener("click", () => openLogs(logsRoot));
      element.replaceChildren(button);
    }
    if (timed && clock === null) { clock = setInterval(() => latest && render(latest.roots, latest.build), CLOCK_MS); }
    if (!timed && clock !== null) { clearInterval(clock); clock = null; }
  }

  return { element, render };
}
