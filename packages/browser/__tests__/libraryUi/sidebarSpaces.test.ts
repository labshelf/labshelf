// Checks that browser Space rows follow the store and stop updating after disposal.
import type { SpaceStore, SpacesHostPort } from "@labshelf/core";
import type { LibrarySidebar } from "@labshelf/core/dom";
import { createSidebarSpaces } from "../../src/libraryUi/sidebar";

it("updates sidebar rows on Space changes and unsubscribes on disposal", () => {
  let notify = (): void => undefined;
  let results: unknown[] = [];
  const off = jest.fn();
  const store = { list: () => results, onChange: (listener: () => void) => { notify = listener; return off; } } as unknown as SpaceStore;
  const port = { library: () => new Map(), onLibraryChange: () => off } as unknown as SpacesHostPort;
  const setSpaces = jest.fn();
  const adapter = createSidebarSpaces({ store, port, reload: jest.fn(), dispose: jest.fn() }, { log: jest.fn(), error: jest.fn() });
  const dispose = adapter.attach({ setSpaces } as unknown as LibrarySidebar);
  expect(setSpaces).toHaveBeenLastCalledWith([]);
  results = [{ state: "unreadable", id: "research", reason: "Invalid Space" }];
  notify();
  expect(setSpaces).toHaveBeenLastCalledWith([{ id: "research", name: "research", unreadable: "Invalid Space" }]);
  dispose();
  expect(off).toHaveBeenCalledTimes(2);
});

it("moves a Space to Trash from the sidebar action", async () => {
  const off = jest.fn();
  const setTrashed = jest.fn(async () => undefined);
  const store = { list: () => [], onChange: () => off, setTrashed } as unknown as SpaceStore;
  const port = { library: () => new Map(), onLibraryChange: () => off } as unknown as SpacesHostPort;
  const adapter = createSidebarSpaces({ store, port, reload: jest.fn(), dispose: jest.fn() }, { log: jest.fn(), error: jest.fn() });
  adapter.actions.trashSpace("research");
  await Promise.resolve();
  expect(setTrashed).toHaveBeenCalledWith("research", true);
});
