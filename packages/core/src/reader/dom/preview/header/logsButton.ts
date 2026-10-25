// Shows the shown root's warning and error count in the header, with a menu that opens each problem or the logs.
import { renderElement } from "../../../../ui/dom/index.js";
import { renderIcon } from "../../../../ui/index.js";
import type { PreviewRoot, PreviewRoots, WebviewToHost } from "../../../index.js";
import { buildMenu, iconButton, togglePopover, type MenuItem } from "../../elements/index.js";

interface LogsButtonDeps {
  post: (msg: WebviewToHost) => void;
  openLogs(root: string): void;
}

function isProblem(p: PreviewRoot["problems"][number]): boolean {
  return p.severity !== "info";
}

function menuItems(root: PreviewRoot, { post, openLogs }: LogsButtonDeps): MenuItem[] {
  const items: MenuItem[] = [];
  root.problems.forEach((problem, index) => {
    if (!isProblem(problem)) { return; }
    const hint = problem.file === undefined ? undefined : problem.line === undefined ? problem.file : `${problem.file}:${problem.line}`;
    items.push({ label: problem.message, ...(hint !== undefined && { hint }), run: () => post({ command: "openProblem", root: root.path, index }) });
  });
  items.push({ label: "Show all", separatorBefore: items.length > 0, run: () => openLogs(root.path) });
  if (root.rawLog) { items.push({ label: "Open raw log", run: () => post({ command: "openRawLog", root: root.path }) }); }
  return items;
}

/**
 * Mounts the logs button into the header's `logs` slot and reveals the slot.
 * @returns `setRoots`, which the host's roots messages drive.
 */
export function mountLogsButton(slot: HTMLElement, deps: LogsButtonDeps): { setRoots(roots: PreviewRoots): void } {
  const button = iconButton(renderIcon("log"), "Logs");
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  const count = renderElement("span", { class: "rd-logs-count", "aria-hidden": "true", hidden: true });
  button.append(count);
  let shown: PreviewRoot | undefined;

  button.addEventListener("click", () => {
    if (shown) { togglePopover(button, buildMenu(menuItems(shown, deps)), "below"); }
  });
  slot.hidden = false;
  slot.append(button);

  return {
    setRoots(roots) {
      shown = roots.roots.find((r) => r.path === roots.shown);
      const problems = shown?.problems.filter(isProblem) ?? [];
      const label = problems.length === 0 ? "Logs" : `Logs, ${problems.length} ${problems.length === 1 ? "problem" : "problems"}`;
      count.hidden = problems.length === 0;
      count.textContent = String(problems.length);
      count.dataset["tone"] = problems.some((p) => p.severity === "error") ? "error" : "warning";
      button.title = label;
      button.setAttribute("aria-label", label);
    },
  };
}
