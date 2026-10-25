// Shows the findings of the last pre-submission check in the footer and runs the check again on click.
import { renderElement } from "../../../../ui/dom/index.js";
import type { PreviewRoots, WebviewToHost } from "../../../index.js";

interface ChecksButtonDeps {
  post: (msg: WebviewToHost) => void;
}

/**
 * Mounts the checks button into the footer's `checks` slot; the slot stays hidden until a check has run.
 * @returns `setRoots`, which the host's roots messages drive.
 */
export function mountChecksButton(slot: HTMLElement, { post }: ChecksButtonDeps): { setRoots(roots: PreviewRoots): void } {
  const button = renderElement("button", { class: "rd-checks", type: "button", title: "Check before submitting" });
  button.addEventListener("click", () => post({ command: "runCommand", id: "checkBeforeSubmitting" }));
  slot.append(button);

  return {
    setRoots({ checks }) {
      slot.hidden = checks === undefined;
      if (checks === undefined) { return; }
      button.replaceChildren(renderElement("span", { class: "rd-checks-count", "data-tone": checks > 0 ? "warning" : "ok" }, String(checks)), ` ${checks === 1 ? "check" : "checks"}`);
    },
  };
}
