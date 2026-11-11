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
  return { stops, port, ctx: { spaces: { store, port } as never, logger, fs: {} as never } };
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

  it("answers a note's From paper… call with the page's paper objects port", async () => {
    const { ctx } = setup();
    const choices = [{ id: "p1", citeKey: "k", title: "T", authors: "A", year: "2020" }];
    const paperObjects = { papers: jest.fn(async () => choices), list: jest.fn(), preview: jest.fn(), insert: jest.fn() };
    const replies: unknown[] = [];
    mountSpacesTab({} as HTMLElement, { ...ctx, paperObjects }, (_host, ui) => {
      (ui as unknown as { subscribe(listener: (message: unknown) => void): void }).subscribe((message) => { replies.push(message); });
      ui.post({ type: "space.paperObjects", request: { type: "paperObjects.request", requestId: "r1", call: { op: "papers", query: "att" } } });
      return () => undefined;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(paperObjects.papers).toHaveBeenCalledWith("att");
    expect(replies).toContainEqual(expect.objectContaining({ type: "paperObjects.reply", requestId: "r1" }));
  });
});
