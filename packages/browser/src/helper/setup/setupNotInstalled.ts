// Builds the not-installed card's install steps and the desktop-app alternatives to the standalone helper.
import { el } from "@labshelf/core/dom";

export const LOOK_BACK_NOTE = "Come back here. This section notices the helper on its own and offers to install TeX if this computer has none.";

export function installSteps(isMac: boolean): HTMLElement {
  const steps = [
    "Download LabShelf Helper and run the installer.",
    isMac ? "Open it once. macOS asks you to confirm an app from the internet; the guide below shows how." : undefined,
  ];
  return el("ol", { class: "setting-desc" }, ...steps.map((step) => step && el("li", { text: step })));
}

// The Windows helper is signed; the macOS and Linux builds are not, which is why the desktop apps come first there.
export function desktopAlternatives(os: string): HTMLElement[] {
  const without = os === "win" ? "installing another program" : "installing an unsigned program";
  return [
    el("p", {
      class: "setting-desc",
      text: `Already use LabShelf in VS Code or the terminal? Either one builds LaTeX for the browser without ${without}.`,
    }),
    el("ul", { class: "setting-desc" },
      el("li", { text: "In VS Code, run LabShelf: Build LaTeX for the Browser from the Command Palette." }),
      el("li", {}, "In a terminal, run ", el("code", { text: "labshelf helper install" }), ". To get the terminal app, run ", el("code", { text: "npm install -g @labshelf/terminal" }), "."),
    ),
  ];
}
