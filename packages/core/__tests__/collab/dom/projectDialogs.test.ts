/** @jest-environment jsdom */
import { runJoinProjectDialog, runLeaveProjectDialog, runShareProjectDialog, createProjectShareMenuEntries } from "../../../src/collab/dom/index.js";
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

describe("share dialog", () => {
  it("shows the problem of a shared project with its invite", async () => {
    const problem = "Edits are not written to disk: QuotaExceededError";
    const host = fakeHost({ projectStatus: jest.fn(async () => ({ kind: "shared" as const, connected: true, problem })) });
    void runShareProjectDialog(host, "p1");
    await tick();
    await tick();
    expect(document.body.textContent).toContain("labshelf://join#x");
    expect(document.body.textContent).toContain(problem);
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

describe("createProjectShareMenuEntries", () => {
  it("is empty when the host offers no project sharing", () => {
    const host = fakeHost({ offers: jest.fn(() => ({ projects: false, links: true })) });
    expect(createProjectShareMenuEntries(host, { id: "p1", shared: false })).toEqual([]);
  });
});
