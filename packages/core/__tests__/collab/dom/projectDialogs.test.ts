/** @jest-environment jsdom */
import { runInviteByEmailDialog, runJoinProjectDialog, runLeaveProjectDialog, runShareProjectDialog, createProjectShareMenuEntries } from "../../../src/collab/dom/index.js";
import type { ContactView } from "../../../src/share/index.js";
import { clickButton, fakeHost, tick } from "./fakeHost";

afterEach(() => { document.body.innerHTML = ""; });

const flush = async (): Promise<void> => { for (let i = 0; i < 4; i++) await tick(); };

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

describe("invite by email dialog", () => {
  const contacts: ContactView[] = [{ name: "Alice", email: "alice@example.org", fingerprint: "f1" }, { name: "Albert", fingerprint: "f2" }];
  const emailInput = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>('input[type="email"]');
  const typeEmail = (text: string): void => {
    const input = emailInput()!;
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const options = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".ls-combobox-option")];

  // One test for both confirmations: toasts land in a container made once per file, which the afterEach body reset would detach.
  it("suggests only the contacts with an email, sends to the picked one and confirms a direct or directory send naming the email", async () => {
    const host = fakeHost({ contacts: jest.fn(async () => contacts), inviteByEmail: jest.fn(async () => ({ sent: "direct" as const })) });
    const done = runInviteByEmailDialog(host, "p1");
    await flush();
    typeEmail("al");
    expect(options().map((o) => o.textContent)).toEqual(["Alicealice@example.org"]);
    options()[0]!.click();
    expect(emailInput()!.value).toBe("alice@example.org");
    clickButton("Send Invitation");
    await done;
    expect(host.inviteByEmail).toHaveBeenCalledWith("p1", "alice@example.org");
    expect(document.body.textContent).toContain("alice@example.org");

    host.inviteByEmail.mockResolvedValueOnce({ sent: "directory" });
    const again = runInviteByEmailDialog(host, "p1");
    await flush();
    typeEmail("bob@example.org");
    clickButton("Send Invitation");
    await again;
    expect(host.inviteByEmail).toHaveBeenLastCalledWith("p1", "bob@example.org");
    expect(document.body.textContent).toContain("bob@example.org");
  });

  it("shows the host's message on the fallback and copies the invite link", async () => {
    const message = "No LabShelf invitations for this email; copy the invite link instead";
    const host = fakeHost({ inviteByEmail: jest.fn(async () => ({ fallback: "link" as const, link: "labshelf://join#y", message })) });
    const done = runInviteByEmailDialog(host, "p1");
    await flush();
    typeEmail("bob@example.org");
    clickButton("Send Invitation");
    await flush();
    expect(document.body.textContent).toContain(message);
    clickButton("Copy Invite Link");
    await done;
    expect(host.copyText).toHaveBeenCalledWith("labshelf://join#y");
  });

  it("gives no suggestions when the contacts cannot be read, and sends nothing on Cancel", async () => {
    const host = fakeHost({ contacts: jest.fn(async () => { throw new Error("no store"); }) });
    const done = runInviteByEmailDialog(host, "p1");
    await flush();
    typeEmail("al");
    expect(options()).toEqual([]);
    clickButton("Cancel");
    await done;
    expect(host.inviteByEmail).not.toHaveBeenCalled();
  });

  it("is reachable from the share dialog of a shared project", async () => {
    const host = fakeHost({ projectStatus: jest.fn(async () => ({ kind: "shared" as const, connected: true })) });
    void runShareProjectDialog(host, "p1");
    await flush();
    clickButton("Invite by Email…");
    await flush();
    expect(emailInput()).not.toBeNull();
  });
});

describe("createProjectShareMenuEntries", () => {
  const labels = (host: ReturnType<typeof fakeHost>, shared: boolean): string[] =>
    createProjectShareMenuEntries(host, { id: "p1", shared }).flatMap((e) => (e === "separator" ? [] : [e.label]));

  it("is empty when the host offers no project sharing", () => {
    const host = fakeHost({ offers: jest.fn(() => ({ projects: false, links: true })) });
    expect(createProjectShareMenuEntries(host, { id: "p1", shared: false })).toEqual([]);
  });

  it("offers Invite by Email… before Copy Invite Link for a shared project only", () => {
    const shared = labels(fakeHost(), true);
    expect(shared.indexOf("Invite by Email…")).toBeGreaterThanOrEqual(0);
    expect(shared.indexOf("Invite by Email…")).toBeLessThan(shared.indexOf("Copy Invite Link"));
    expect(labels(fakeHost(), false)).not.toContain("Invite by Email…");
  });

  it("opens the Invite by Email dialog from its entry", async () => {
    const host = fakeHost();
    const entry = createProjectShareMenuEntries(host, { id: "p1", shared: true }).find((e) => e !== "separator" && e.label === "Invite by Email…");
    if (!entry || entry === "separator") throw new Error("no entry");
    entry.onSelect();
    await flush();
    expect(document.querySelector('input[type="email"]')).not.toBeNull();
  });
});
