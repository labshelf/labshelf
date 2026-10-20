/** @jest-environment jsdom */
import { runJoinProjectDialog, runLeaveProjectDialog, projectShareMenuEntries } from "../../../src/collab/dom/index.js";
import { clickButton, fakeHost, tick } from "./fakeHost";

afterEach(() => { document.body.innerHTML = ""; });

describe("join dialog", () => {
  it("aborts the signal when the user cancels the wait", async () => {
    let signal!: AbortSignal;
    const host = fakeHost({ joinProject: jest.fn((_i, s) => new Promise(() => { signal = s; })) });
    void runJoinProjectDialog(host, "labshelf://join#x");
    await tick();
    clickButton("Cancel");
    expect(signal.aborted).toBe(true);
  });

  it("never opens the project after a refusal", async () => {
    const host = fakeHost({ joinProject: jest.fn(async () => ({ kind: "refused" as const, problem: "no" })) });
    const done = runJoinProjectDialog(host, "labshelf://join#x");
    await tick();
    clickButton("OK");
    await done;
    expect(host.openProject).not.toHaveBeenCalled();
  });
});

describe("leave dialog", () => {
  it("does not leave when the confirmation is dismissed", async () => {
    const host = fakeHost();
    const done = runLeaveProjectDialog(host, "p1");
    await tick();
    clickButton("Cancel");
    await done;
    expect(host.leaveProject).not.toHaveBeenCalled();
  });
});

describe("projectShareMenuEntries", () => {
  it("is empty when the host offers no project sharing", () => {
    const host = fakeHost({ offers: jest.fn(() => ({ projects: false, links: true })) });
    expect(projectShareMenuEntries(host, { id: "p1", shared: false })).toEqual([]);
  });
});
