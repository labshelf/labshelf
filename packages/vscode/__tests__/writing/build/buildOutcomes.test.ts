// Tests that the last build of each project folder is remembered for the session and announced when it ends.
import { BuildOutcomes } from "../../../src/writing/build/buildOutcomes";
import { readyEntry } from "../../support/writingFixtures";

// Seam: new BuildOutcomes(now?: () => Date) implements BuildListener; last(folder): { ok: boolean; at: Date } | undefined; onDidChange: Event<string> (the folder).
const project = readyEntry("/lib/projects/a") as never;
const at = new Date(2026, 0, 1, 14, 5);

describe("BuildOutcomes", () => {
  it("knows nothing about a project that was never built", () => {
    expect(new BuildOutcomes(() => at).last("/lib/projects/a")).toBeUndefined();
  });

  it("records a failed build with its time", () => {
    const outcomes = new BuildOutcomes(() => at);
    outcomes.finished(project, "main.tex", { status: "failed", problems: [] }, "command");
    expect(outcomes.last("/lib/projects/a")).toEqual({ ok: false, at });
  });

  it("keeps only the latest build of a folder", () => {
    const outcomes = new BuildOutcomes(() => at);
    outcomes.finished(project, "main.tex", { status: "failed", problems: [] }, "save");
    outcomes.finished(project, "main.tex", { status: "succeeded", pdf: "/x.pdf", problems: [] }, "save");
    expect(outcomes.last("/lib/projects/a")).toEqual({ ok: true, at });
    expect(outcomes.last("/lib/projects/b")).toBeUndefined();
  });

  it("announces the folder when a build finishes", () => {
    const outcomes = new BuildOutcomes(() => at);
    const changed = jest.fn();
    outcomes.onDidChange(changed);
    outcomes.building("/lib/projects/a", "main.tex");
    expect(changed).not.toHaveBeenCalled();
    outcomes.finished(project, "main.tex", { status: "failed", problems: [] }, "focus");
    expect(changed).toHaveBeenCalledWith("/lib/projects/a");
  });
});
