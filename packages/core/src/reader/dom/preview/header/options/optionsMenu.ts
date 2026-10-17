// Shows the build options of the preview as a header menu: Auto compile and, for LaTeX roots, the engine.
import { icon } from "../../../../../ui/index.js";
import { showMenu, type MenuEntry } from "../../../../../ui/dom/index.js";
import { LATEX_ENGINES, engineLabel } from "../../../../../writing/index.js";
import type { BuildOptions, PreviewRoots, WebviewToHost } from "../../../../index.js";
import { iconButton } from "../../../elements/index.js";

interface OptionsMenuDeps {
  post: (msg: WebviewToHost) => void;
}

function entries(options: BuildOptions, post: OptionsMenuDeps["post"]): MenuEntry[] {
  const list: MenuEntry[] = [
    { label: "Auto compile on save", checked: options.autoCompile, onSelect: () => post({ command: "setAutoCompile", on: !options.autoCompile }) },
  ];
  if (options.engine === undefined) { return list; }
  list.push("separator");
  for (const engine of LATEX_ENGINES) {
    list.push({ label: engineLabel(engine), checked: engine === options.engine, radio: true, onSelect: () => post({ command: "setEngine", engine }) });
  }
  return list;
}

/**
 * Mounts the chevron button into the header's `options` slot; the slot shows while the roots carry build options.
 * @returns `setRoots`, which the host's roots messages drive.
 */
export function mountOptionsMenu(slot: HTMLElement, { post }: OptionsMenuDeps): { setRoots(roots: PreviewRoots): void } {
  const button = iconButton(icon("chevron-down"), "Build options");
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  let options: BuildOptions | undefined;

  button.addEventListener("click", () => {
    if (!options) { return; }
    button.setAttribute("aria-expanded", "true");
    showMenu(button, entries(options, post), {
      onClose: () => { button.setAttribute("aria-expanded", "false"); button.focus(); },
    });
  });
  slot.append(button);

  return {
    setRoots(roots) {
      options = roots.options;
      slot.hidden = options === undefined;
    },
  };
}
