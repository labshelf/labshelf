// The page's sharing host offers projects only once the project wiring hands over their deps, and tells its listeners.
import { createSharingHost, type ProjectSharingDeps, type ShareWorkflowPorts } from "@labshelf/core";
import { createPageSharingHost } from "../../../../src/libraryUi/host/handlers/browserShareHost";

const logger = { log: async () => undefined, error: async () => undefined };
const build = (projects?: ProjectSharingDeps) => createSharingHost({
  place: "this browser", logger, clipboard: { write: async () => undefined }, openLink: async () => undefined, ...(projects ? { projects } : {}),
});
const deps: ProjectSharingDeps = {
  ports: { projects: { list: () => [] } } as unknown as ShareWorkflowPorts,
  idOf: (entry) => entry.folder,
  open: async () => undefined,
};

describe("page sharing host", () => {
  it("refuses projects before the project wiring adds them", async () => {
    const { host } = createPageSharingHost(build);
    expect(host.offers().projects).toBe(false);
    await expect(host.projects()).rejects.toThrow("does not share projects");
  });

  it("offers projects after addProjects and tells the offers listeners", async () => {
    const page = createPageSharingHost(build);
    const listener = jest.fn();
    page.host.onOffersChange(listener);
    page.addProjects(deps);
    expect(page.host.offers().projects).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    await expect(page.host.projects()).resolves.toEqual([]);
  });
});
