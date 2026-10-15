// Tests that the project store lists the library's projects, tolerates failures and keeps the newest reload.
import { listProjects } from "@labshelf/core/node";

import { WritingProjects } from "../../src/writing";
import { fakeHost, readyEntry } from "../support/writingFixtures";

jest.mock("@labshelf/core/node", () => ({ ...jest.requireActual("@labshelf/core/node"), listProjects: jest.fn() }));
const list = listProjects as jest.Mock;

describe("WritingProjects", () => {
  beforeEach(() => list.mockReset());

  it("loads the projects of the session's library and announces the change", async () => {
    const host = fakeHost();
    const entry = readyEntry("/lib/projects/a");
    list.mockResolvedValue([entry]);
    const store = new WritingProjects(host);
    const changed = jest.fn();
    store.onDidChange(changed);
    await store.reload();
    expect(list).toHaveBeenCalledWith("/lib", host.session.logger);
    expect(store.list()).toEqual([entry]);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("is empty while no library is configured", async () => {
    const store = new WritingProjects({ current: () => undefined });
    await store.reload();
    expect(store.list()).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });

  it("logs a failed listing and shows no projects", async () => {
    const host = fakeHost();
    list.mockRejectedValue(new Error("disk"));
    const store = new WritingProjects(host);
    await store.reload();
    expect(host.session.logger.error).toHaveBeenCalledWith("writing/projects", expect.any(Error), { action: "list" });
    expect(store.list()).toEqual([]);
  });

  it("keeps the result of the newest reload when an older one finishes last", async () => {
    const store = new WritingProjects(fakeHost());
    let finishOld!: (entries: unknown[]) => void;
    list.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    const newest = readyEntry("/lib/projects/new");
    list.mockResolvedValueOnce([newest]);
    const older = store.reload();
    await store.reload();
    finishOld([readyEntry("/lib/projects/old")]);
    await older;
    expect(store.list()).toEqual([newest]);
  });
});
