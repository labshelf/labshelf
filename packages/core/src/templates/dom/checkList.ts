// Renders the Checks section of the Publish screen: the run button, one status row per check and a spoken summary.
import { renderIcon, type IconName } from "../../ui/index.js";
import { renderElement } from "../../ui/dom/index.js";
import type { PublishCheckResult } from "../protocol/index.js";
import { PUBLISH_CHECK_IDS, publishCheckLabel, type PublishCheckId } from "../publishCheckLabels.js";

type CheckRowState = "idle" | "running" | "passed" | "failed";

export interface CheckList {
  element: HTMLElement;
  /** Patches every row and the summary; `canRun` enables the run button when the form is valid. */
  update(results: readonly PublishCheckResult[], running: boolean, canRun: boolean): void;
}

// The icon set has no empty circle; a dash reads as "not run yet".
const ROW_ICONS: Record<CheckRowState, IconName> = { idle: "minus", running: "loader", passed: "check", failed: "x" };

interface Row { id: PublishCheckId; item: HTMLLIElement; icon: HTMLElement; message: HTMLElement }

function rowState(result: PublishCheckResult | undefined, running: boolean): CheckRowState {
  if (result?.ok === true) return "passed";
  if (result?.ok === false) return "failed";
  return running ? "running" : "idle";
}

/** "All checks passed", "2 checks failed", "3 of 6 checks passed" or "" before any run. */
function checkSummary(states: readonly CheckRowState[], running: boolean): string {
  const passed = states.filter((s) => s === "passed").length;
  const failed = states.filter((s) => s === "failed").length;
  if (failed > 0) return `${failed} ${failed === 1 ? "check" : "checks"} failed`;
  if (running) return "Running checks…";
  if (passed === states.length) return "All checks passed";
  return passed > 0 ? `${passed} of ${states.length} checks passed` : "";
}

function buildRow(id: PublishCheckId, engineLabel: string): Row {
  const iconBox = renderElement("span", { class: "ls-tpl-check-icon" });
  const message = renderElement("div", { class: "ls-tpl-check-message" });
  const item = renderElement("li", { class: "ls-tpl-check", "data-state": "idle" },
    iconBox, renderElement("div", { class: "ls-tpl-check-text" }, renderElement("div", { text: publishCheckLabel(id, engineLabel) }), message));
  return { id, item, icon: iconBox, message };
}

export function createCheckList(engineLabel: string, onRun: () => void): CheckList {
  const rows = PUBLISH_CHECK_IDS.map((id) => buildRow(id, engineLabel));
  const run = renderElement("button", { class: "ls-btn", type: "button", text: "Run checks" });
  const summary = renderElement("p", { class: "ls-tpl-check-summary", "aria-live": "polite" });
  run.addEventListener("click", onRun);
  const element = renderElement("div", { class: "ls-tpl-checks" },
    renderElement("div", { class: "ls-tpl-publish-section" }, renderElement("h2", { text: "Checks" }), run),
    renderElement("ul", { class: "ls-tpl-check-list", role: "list" }, ...rows.map((row) => row.item)),
    summary);

  const update = (results: readonly PublishCheckResult[], running: boolean, canRun: boolean): void => {
    const states = rows.map((row) => {
      const result = results.find((r) => r.id === row.id);
      const state = rowState(result, running);
      row.item.dataset["state"] = state;
      if (state === "running") row.item.setAttribute("aria-busy", "true");
      else row.item.removeAttribute("aria-busy");
      row.icon.innerHTML = renderIcon(ROW_ICONS[state]);
      row.icon.classList.toggle("ls-tpl-spin", state === "running");
      row.message.textContent = state === "failed" ? (result?.message ?? "") : "";
      return state;
    });
    summary.textContent = checkSummary(states, running);
    run.disabled = running || !canRun;
  };
  update([], false, true);
  return { element, update };
}
