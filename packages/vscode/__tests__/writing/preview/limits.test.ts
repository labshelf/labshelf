// Tests the limits patch written to labshelf.yaml.
import { setCheckLimits } from "../../../src/writing/preview/limits";
import { fakeProjects, readyEntry } from "../../support/writingFixtures";

describe("limits patch", () => {
  const project = readyEntry("/p/tex") as Parameters<typeof setCheckLimits>[1];

  describe("setCheckLimits", () => {
    it("patches only the fields in the change and reloads the projects", async () => {
      const projects = fakeProjects();
      await setCheckLimits(projects, project, { pages: 8, countUpTo: "end" });
      const patch = projects.data.updateProjectSettings.mock.calls[0]![1];
      expect(projects.data.updateProjectSettings.mock.calls[0]![0]).toBe("/p/tex");
      expect(patch).toEqual({ check: { pages: 8, countUpTo: "end" } });
      expect(Object.keys(patch.check)).toEqual(["pages", "countUpTo"]);
      expect(projects.reload).toHaveBeenCalledTimes(1);
    });

    it("turns null into a removal", async () => {
      const projects = fakeProjects();
      await setCheckLimits(projects, project, { words: null });
      const patch = projects.data.updateProjectSettings.mock.calls[0]![1];
      expect(Object.keys(patch.check)).toEqual(["words"]);
      expect(patch.check.words).toBeUndefined();
    });
  });
});
