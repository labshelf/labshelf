// Tests how a project's build in this session is summarised for the All projects page.
import { summariseBuild, type BuildSources } from "../../../src/writing/allProjects/projectBuildState";
import { readyEntry } from "../../support/writingFixtures";

const project = readyEntry("/lib/projects/a") as Extract<ReturnType<typeof readyEntry>, { kind: "ready" }>;
const problem = (severity: "error" | "warning" | "info", message: string) => ({ severity, message, file: "main.tex", line: 4 });

function sources(over: { outcome?: { ok: boolean; at: Date }; problems?: ReturnType<typeof problem>[]; building?: boolean; pdfModified?: number } = {}) {
  const value: BuildSources = {
    outcomes: { last: () => over.outcome },
    builds: {
      builtRoots: () => ["main.tex"],
      problemsOf: () => over.problems ?? [],
      stateOf: () => (over.building ? { state: "building", errors: 0 } : undefined),
    },
    pdfModified: jest.fn(async () => over.pdfModified),
  };
  return value;
}

describe("summariseBuild", () => {
  it("marks a project with no outcome and a PDF as earlier, dated by the PDF", async () => {
    expect(await summariseBuild(sources({ pdfModified: 500 }), project)).toEqual({ state: "earlier", at: 500, warnings: 0, errors: 0 });
  });

  it("marks a project with neither outcome nor PDF as never built", async () => {
    expect(await summariseBuild(sources(), project)).toEqual({ state: "never", warnings: 0, errors: 0 });
  });

  it("marks a failed outcome as failed with its errors and the first problem", async () => {
    const at = new Date(1000);
    const summary = await summariseBuild(sources({ outcome: { ok: false, at }, problems: [problem("warning", "w"), problem("error", "e1"), problem("error", "e2")] }), project);
    expect(summary).toEqual({ state: "failed", at: 1000, warnings: 1, errors: 2, first: { message: "w", file: "main.tex", line: 4 } });
  });

  it("marks a successful build with warnings as warnings, ignoring info", async () => {
    const summary = await summariseBuild(sources({ outcome: { ok: true, at: new Date(2000) }, problems: [problem("info", "i"), problem("warning", "w")] }), project);
    expect(summary).toMatchObject({ state: "warnings", warnings: 1, errors: 0 });
  });

  it("marks a clean successful build as ok", async () => {
    expect(await summariseBuild(sources({ outcome: { ok: true, at: new Date(2000) } }), project)).toMatchObject({ state: "ok", at: 2000 });
  });

  it("marks a project as building while any root builds", async () => {
    expect((await summariseBuild(sources({ building: true, outcome: { ok: true, at: new Date(2000) } }), project)).state).toBe("building");
  });
});
