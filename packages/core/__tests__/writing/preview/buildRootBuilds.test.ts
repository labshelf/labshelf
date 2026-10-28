/** Verifies the per-root build record: running and failed states, the problems and cites of the last build, and the roots built per project. */
import { posixPathOps } from "../../../src/path/index";
import { BuildRootBuilds } from "../../../src/writing/preview/index";
import type { LocatedProblem } from "../../../src/latex";

const ERROR: LocatedProblem = { severity: "error", message: "Undefined control sequence" } as LocatedProblem;

describe("BuildRootBuilds", () => {
  it("shows a running build, then forgets the state of a successful one", () => {
    const builds = new BuildRootBuilds(posixPathOps);
    builds.started("/p", "main.tex");
    expect(builds.stateOf("/p", "main.tex")).toEqual({ state: "building", errors: 0 });
    expect(builds.finished("/p", "main.tex", { status: "succeeded", pdf: "x.pdf", problems: [] })).toBe(0);
    expect(builds.stateOf("/p", "main.tex")).toBeUndefined();
    expect([...builds.builtRoots("/p")]).toEqual(["main.tex"]);
  });

  it("keeps a failed build's state and error count, and the cites of the last success", () => {
    const builds = new BuildRootBuilds(posixPathOps);
    const cites = [{ key: "doe" }] as never;
    builds.finished("/p", "main.typ", { status: "succeeded", pdf: "x.pdf", problems: [], cites });
    expect(builds.finished("/p", "main.typ", { status: "failed", problems: [ERROR, { ...ERROR, severity: "warning" }] })).toBe(1);
    expect(builds.stateOf("/p", "main.typ")).toEqual({ state: "failed", errors: 1 });
    expect(builds.citesOf("/p", "main.typ")).toBe(cites);
    expect(builds.problemsOf("/p", "main.typ")).toHaveLength(2);
  });

  it("answers no problems for a root the project has not built", () => {
    const builds = new BuildRootBuilds(posixPathOps);
    expect(builds.problemsOf("/p", "main.tex")).toBeUndefined();
    expect([...builds.builtRoots("/p")]).toEqual([]);
  });
});
