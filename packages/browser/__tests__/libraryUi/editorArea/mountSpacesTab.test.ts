// Tests that mountSpacesTab serves the Spaces host over a loopback, hands the UI end to the mount and stops both when disposed.
import type { ILogger, SpacesHostPort, SpaceStore, SpacesToHost } from "@labshelf/core";
import { mountSpacesTab } from "../../../src/libraryUi/editorArea/mountSpacesTab";

const logger: ILogger = { log: async () => undefined, error: async () => undefined };

function setup() {
  const stops = { store: jest.fn(), library: jest.fn(), projects: jest.fn() };
  const store = { onChange: () => stops.store } as unknown as SpaceStore;
  const port = {
    onLibraryChange: () => stops.library,
    onProjectsChange: () => stops.projects,
    openCatalog: jest.fn(async () => undefined),
  } as unknown as SpacesHostPort;
  return { stops, port, ctx: { spaces: { store, port } as never, logger } };
}

describe("mountSpacesTab", () => {
  it("mounts into the host with a UI end that reaches the served Spaces port", () => {
    const { ctx, port } = setup();
    const host = {} as HTMLElement;
    const mount = jest.fn((_host: HTMLElement, ui: { post(message: SpacesToHost): void }) => {
      ui.post({ type: "openCatalog" });
      return () => undefined;
    });
    mountSpacesTab(host, ctx, mount);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(mount.mock.calls[0]![0]).toBe(host);
    expect(port.openCatalog).toHaveBeenCalledTimes(1);
  });

  it("stops the mount first, then the serving, when disposed", () => {
    const { ctx, stops } = setup();
    const order: string[] = [];
    stops.store.mockImplementation(() => order.push("serve"));
    const { dispose } = mountSpacesTab({} as HTMLElement, ctx, () => () => { order.push("mount"); });
    expect(order).toEqual([]);
    dispose();
    expect(order).toEqual(["mount", "serve"]);
    expect(stops.library).toHaveBeenCalledTimes(1);
    expect(stops.projects).toHaveBeenCalledTimes(1);
  });
});
