// Chooses what a preview's build notice says from the build state and the build roots, and shows it on the reader's banner.
import type { BuildState, PreviewRoot, PreviewRoots } from "../../index.js";
import type { BuildBanner } from "../chrome/index.js";
import { fileName } from "./fileName.js";

const errorCount = (root: PreviewRoot): number => root.problems.filter((p) => p.severity === "error").length;

function count(n: number): string {
  return `${n} ${n === 1 ? "error" : "errors"}`;
}

/** Keeps the banner in step with the build: building, then the shown root's failure, then the focused root's. */
export class PreviewNotice {
  private roots: PreviewRoots | null = null;
  private state: BuildState = "succeeded";
  private errors = 0;

  constructor(private readonly banner: BuildBanner, private readonly openLogs: (rootPath: string) => void) {}

  setRoots(roots: PreviewRoots): void {
    this.roots = roots;
    this.render();
  }

  setBuild(state: BuildState, errors: number): void {
    this.state = state;
    this.errors = errors;
    this.render();
  }

  private render(): void {
    if (this.state === "building") { return this.banner.showBusy(); }
    const { roots } = this;
    // Before the roots arrive the build message alone says whether the shown document failed.
    if (!roots) { return this.state === "failed" ? this.showFailed("Build failed", this.errors, "") : this.banner.clear(); }
    const shown = roots.roots.find((r) => r.path === roots.shown);
    if (shown?.failed) { return this.showFailed("Build failed", errorCount(shown), shown.path); }
    const focused = roots.focused === roots.shown ? undefined : roots.roots.find((r) => r.path === roots.focused);
    if (focused?.failed) { return this.showFailed(fileName(focused.path), errorCount(focused), focused.path); }
    this.banner.clear();
  }

  private showFailed(name: string, errors: number, rootPath: string): void {
    this.banner.showFailed({
      label: errors > 0 ? `${name}: ${count(errors)}` : name,
      title: "Open the build logs",
      onClick: () => this.openLogs(rootPath),
    });
  }
}
