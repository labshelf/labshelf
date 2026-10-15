/**
 * Shows a preview's build state at the top of the reader: a quiet note while a build runs, and after a failure the
 * error count as a button that opens the first error.
 */
import type { BuildState } from "../../index.js";
import { icon } from "../../../ui/index.js";
import type { HostBridge } from "../session/index.js";
import { $, el } from "../../../ui/dom/index.js";

export class BuildBanner {
  private readonly root = $("build-banner");

  constructor(private readonly host: HostBridge) {}

  /**
   * Shows the state the host reported; a build that succeeded clears the banner.
   */
  show(state: BuildState, errors: number): void {
    if (state === "building") {
      this.render("rd-build-busy", el("span", { class: "rd-build-icon rd-spin", html: icon("loader") }), "Building…");
    } else if (state === "failed") {
      this.showFailure(errors);
    } else {
      this.clear();
    }
  }

  /**
   * Reports a PDF the reader could not reload; the open document stays on screen.
   */
  showReloadError(message: string): void {
    this.render("rd-build-failed", el("span", { class: "rd-build-icon", html: icon("warning") }), `Could not reload the PDF: ${message}`);
  }

  private showFailure(errors: number): void {
    const count = errors > 0 ? `: ${errors} ${errors === 1 ? "error" : "errors"}` : "";
    const button = el("button", {
      class: "rd-build-action",
      type: "button",
      title: "Open the first error",
    }, el("span", { class: "rd-build-icon", html: icon("warning") }), `Build failed${count}`);
    button.addEventListener("click", () => this.host.post({ command: "showBuildProblem" }));
    this.root.className = "rd-build-failed";
    this.root.replaceChildren(button, el("span", { class: "rd-build-note" }, "Showing the last successful build"));
    this.root.hidden = false;
  }

  private render(kind: string, glyph: HTMLElement, text: string): void {
    this.root.className = kind;
    this.root.replaceChildren(glyph, el("span", {}, text));
    this.root.hidden = false;
  }

  private clear(): void {
    this.root.hidden = true;
    this.root.replaceChildren();
  }
}
