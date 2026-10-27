// The page's sharing host offers projects only once the project wiring hands over their deps, and tells its listeners.
import { createShareHost, type ProjectShareDeps, type ShareFlowPorts } from "@labshelf/core";
import { createPageShareHost } from "../../../src/libraryUi/host/browserShareHost";

const logger = { log: async () => undefined, error: async () => undefined };
const build = (projects?: ProjectShareDeps) => createShareHost({
  place: "this browser", logger, clipboard: { write: async () => undefined }, openLink: async () => undefined, ...(projects ? { projects } : {}),
});
const deps: ProjectShareDeps = {
  ports: { projects: { list: () => [] } } as unknown as ShareFlowPorts,
  idOf: (entry) => entry.folder,
  open: async () => undefined,
};

describe("page sharing host", () => {
  it("refuses projects before the project wiring adds them", async () => {
    const { host } = createPageShareHost(build);
    expect(host.offers().projects).toBe(false);
    await expect(host.projects()).rejects.toThrow("does not share projects");
  });

  it("offers projects after addProjects and tells the offers listeners", async () => {
    const page = createPageShareHost(build);
    const listener = jest.fn();
    page.host.onOffersChange(listener);
    page.addProjects(deps);
    expect(page.host.offers().projects).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    await expect(page.host.projects()).resolves.toEqual([]);
  });
});
