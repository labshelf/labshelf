// Mounts the header's `<file> only` toggle, which builds only the focused included file.
import { renderElement } from "../../../../ui/dom/index.js";
import type { PreviewRoots, WebviewToHost } from "../../../index.js";

interface OnlyToggleDeps {
  post: (msg: WebviewToHost) => void;
}

/**
 * Mounts the toggle into the header's `only` slot; the slot stays hidden while the shown root offers no `includeOnly`.
 * @returns `setRoots`, which the host's roots messages drive.
 */
export function mountOnlyToggle(slot: HTMLElement, { post }: OnlyToggleDeps): { setRoots(roots: PreviewRoots): void } {
  const button = renderElement("button", { class: "rd-preview-only", type: "button", "aria-pressed": "false" });
  let on = false;
  button.addEventListener("click", () => post({ command: "setIncludeOnly", on: !on }));
  slot.append(button);

  return {
    setRoots(roots) {
      const only = roots.options?.includeOnly;
      slot.hidden = only === undefined;
      if (only === undefined) { return; }
      on = only.on;
      const name = only.file.split("/").pop() ?? only.file;
      button.textContent = `${name} only`;
      button.title = `Build only ${only.file} with \\includeonly. Page numbers and references from the other chapters are kept from their .aux files.`;
      button.setAttribute("aria-pressed", String(on));
    },
  };
}
