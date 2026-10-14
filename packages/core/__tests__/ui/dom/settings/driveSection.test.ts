/** @jest-environment jsdom */
import { driveSection, type DriveActions } from "../../../../src/ui/dom/settings/index.js";

const signedOut = { connected: false, syncing: false, lastSyncTime: null, lastError: null };
const signedIn = { ...signedOut, connected: true };

function setup() {
  const actions: DriveActions = { connect: jest.fn(), syncNow: jest.fn(), disconnect: jest.fn() };
  const section = driveSection({ description: "Syncs the library.", actions });
  document.body.replaceChildren(section.element);
  const labels = (): string[] => [...section.element.querySelectorAll("button")].map((b) => b.textContent ?? "");
  return { actions, section, labels };
}

describe("driveSection", () => {
  it("offers only a primary Connect button while signed out", () => {
    const { section, labels } = setup();
    section.update(signedOut);
    expect(labels()).toEqual(["Connect to Google Drive"]);
    expect(section.element.querySelector(".ls-btn-primary")?.textContent).toBe("Connect to Google Drive");
    expect(section.element.querySelector(".settings-status")?.textContent).toBe("Not connected to Google Drive");
  });

  it("offers secondary Sync now and Disconnect while signed in, each with an icon", () => {
    const { section, labels } = setup();
    section.update(signedIn);
    expect(labels()).toEqual(["Sync now", "Disconnect"]);
    expect(section.element.querySelector(".ls-btn-primary")).toBeNull();
    for (const b of section.element.querySelectorAll("button")) { expect(b.querySelector("svg")).not.toBeNull(); }
    expect(section.element.querySelector(".ls-dot")?.className).toContain("s-ok");
  });

  it("disables every action while a sync runs and says Syncing…", () => {
    const { section } = setup();
    section.update({ ...signedIn, syncing: true });
    expect([...section.element.querySelectorAll("button")].every((b) => b.disabled)).toBe(true);
    expect(section.element.querySelector(".settings-status")?.textContent).toBe("Syncing…");
  });

  it("shows the last error after the status, in the error style", () => {
    const { section } = setup();
    section.update({ ...signedIn, lastError: "Quota <b>exceeded</b>" });
    const error = section.element.querySelector(".settings-status-error");
    expect(error?.textContent).toBe(" — Quota <b>exceeded</b>");
    expect(error?.querySelector("b")).toBeNull();
    expect(section.element.querySelector(".ls-dot")?.className).toContain("s-error");
  });

  it("calls the handler of the button clicked and disables it until the handler settles", async () => {
    const { actions, section } = setup();
    let finish = (): void => {};
    (actions.syncNow as jest.Mock).mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    section.update(signedIn);
    const syncNow = section.element.querySelector("button") as HTMLButtonElement;
    syncNow.click();
    expect(actions.syncNow).toHaveBeenCalledTimes(1);
    expect(syncNow.disabled).toBe(true);
    finish();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(syncNow.disabled).toBe(false);
  });

  it("routes Connect and Disconnect to their own handlers", () => {
    const { actions, section } = setup();
    section.update(signedOut);
    (section.element.querySelector("button") as HTMLButtonElement).click();
    expect(actions.connect).toHaveBeenCalledTimes(1);
    section.update(signedIn);
    (section.element.querySelectorAll("button")[1] as HTMLButtonElement).click();
    expect(actions.disconnect).toHaveBeenCalledTimes(1);
  });

  it("replaces the buttons with a message when the host cannot report", () => {
    const { section, labels } = setup();
    section.update(signedIn);
    section.showUnavailable("Background unavailable — boom");
    expect(labels()).toEqual([]);
    expect(section.element.querySelector(".settings-status")?.textContent).toBe("Background unavailable — boom");
  });
});
