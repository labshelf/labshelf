// Shows the build options of the preview as a header menu: when to compile and, for LaTeX roots, the engine and whether to stop at the first error.
import { icon } from "../../../../ui/index.js";
import { showMenu, type MenuEntry } from "../../../../ui/dom/index.js";
import { engineLabel } from "../../../../latex/index.js";
import { AUTO_COMPILE_MODES, LATEX_ENGINES, autoCompileLabel } from "../../../../writing/index.js";
import type { BuildOptions, PreviewRoots, WebviewToHost } from "../../../index.js";
import { iconButton } from "../../elements/index.js";

interface OptionsMenuDeps {
  post: (msg: WebviewToHost) => void;
}

function entries(options: BuildOptions, post: OptionsMenuDeps["post"]): MenuEntry[] {
  const list: MenuEntry[] = AUTO_COMPILE_MODES.map((mode) => ({
    label: autoCompileLabel(mode), checked: mode === options.autoCompile, radio: true,
    onSelect: () => post({ command: "setAutoCompile", mode }),
  }));
  if (options.engine === undefined) { return list; }
  list.push("separator");
  for (const engine of LATEX_ENGINES) {
    list.push({ label: engineLabel(engine), checked: engine === options.engine, radio: true, onSelect: () => post({ command: "setEngine", engine }) });
  }
  const halt = options.haltOnError === true;
  list.push(
    "separator",
    { label: "Stop on first error", checked: halt, radio: true, onSelect: () => post({ command: "setHaltOnError", on: true }) },
    { label: "Try to compile despite errors", checked: !halt, radio: true, onSelect: () => post({ command: "setHaltOnError", on: false }) },
  );
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
