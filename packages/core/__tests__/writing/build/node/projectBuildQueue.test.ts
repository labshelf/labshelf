/** Verifies the per-project build queue: a newer request cancels the running build and a waiting request that a later one replaces resolves cancelled. */
import { promises as fs } from "node:fs";

import { ProjectBuildQueue } from "../../../../src/writing/build/node/index";
import { cleanupTempDirs } from "../../../support/tempDirs";
import { buildFixture, runCount } from "./projectBuildFixtures";

const posixOnly = process.platform === "win32" ? describe.skip : describe;

afterEach(cleanupTempDirs);

async function waitForRuns(runs: string, count: number): Promise<void> {
  for (let tries = 0; tries < 200 && (await runCount(runs)) < count; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

posixOnly("ProjectBuildQueue", () => {
  it("cancels the running build and runs the latest waiting request once", async () => {
    const fixture = await buildFixture({ tectonicInstalled: true });
    await fs.writeFile(fixture.marker, "");
    const queue = new ProjectBuildQueue(fixture.deps);
    const project = fixture.project({ engine: "tectonic" });
    const first = queue.request(project);
    await waitForRuns(fixture.runs, 1);
    const second = queue.request(project);
    const third = queue.request(project);
    expect(await first).toEqual({ status: "cancelled" });
    expect(await second).toEqual({ status: "cancelled" });
    expect((await third).status).toBe("succeeded");
    expect(await runCount(fixture.runs)).toBe(2);
  });

  it("keeps serving requests after a build throws", async () => {
    const fixture = await buildFixture({ tectonicInstalled: true });
    let calls = 0;
    const projects = {
      ...fixture.deps.projects,
      projectBuildDir: (id: string): string => {
        calls += 1;
        if (calls === 1) { throw new Error("no build dir"); }
        return fixture.deps.projects.projectBuildDir(id);
      },
    };
    const queue = new ProjectBuildQueue({ ...fixture.deps, projects });
    const project = fixture.project({ engine: "tectonic" });
    await expect(queue.request(project)).rejects.toThrow("no build dir");
    expect((await queue.request(project)).status).toBe("succeeded");
  });
});
