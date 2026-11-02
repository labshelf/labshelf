// The page's sharing host offers projects only once the project wiring hands over their deps, and tells its listeners.
import { createShareHost, type InvitationView, type ProjectShareDeps, type ShareFlowPorts, type ShareHost } from "@labshelf/core";
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

  it("answers the invitation ops as off before the project wiring adds them", async () => {
    const { host } = createPageShareHost(build);
    expect(await host.invitations()).toEqual([]);
    expect(await host.contacts()).toEqual([]);
    expect(await host.invitationsEnabled()).toBe(false);
    await expect(host.setInvitationsEnabled(true)).rejects.toThrow("does not share projects");
  });

  it("forwards every invitation op to the host built last", async () => {
    const invitations = {
      invitations: jest.fn(async () => []), onInvitationsChange: jest.fn(() => () => undefined), acceptInvitation: jest.fn(),
      declineInvitation: jest.fn(async () => undefined), inviteByEmail: jest.fn(), contacts: jest.fn(async () => []),
      invitationsEnabled: jest.fn(async () => true), setInvitationsEnabled: jest.fn(async () => undefined),
    };
    const inner = { ...createShareHost({ place: "this browser", logger, clipboard: { write: async () => undefined }, openLink: async () => undefined }), ...invitations };
    const page = createPageShareHost(() => inner as unknown as ShareHost);
    const signal = new AbortController().signal;
    await page.host.invitations();
    await page.host.acceptInvitation("i", signal);
    await page.host.declineInvitation("i");
    await page.host.inviteByEmail("p", "a@b.c");
    await page.host.contacts();
    expect(await page.host.invitationsEnabled()).toBe(true);
    await page.host.setInvitationsEnabled(true);
    expect(invitations.acceptInvitation).toHaveBeenCalledWith("i", signal);
    expect(invitations.declineInvitation).toHaveBeenCalledWith("i");
    expect(invitations.inviteByEmail).toHaveBeenCalledWith("p", "a@b.c");
    expect(invitations.setInvitationsEnabled).toHaveBeenCalledWith(true);
  });

  it("keeps an invitations listener across addProjects and stops it on request", () => {
    const heard: Array<(list: InvitationView[]) => void> = [];
    const build2 = (projects?: ProjectShareDeps) => ({
      ...build(projects),
      onInvitationsChange: (listener: (list: InvitationView[]) => void) => { heard.push(listener); return () => { heard.splice(heard.indexOf(listener), 1); }; },
      invitations: async () => [],
    }) as ShareHost;
    const page = createPageShareHost(build2);
    const listener = jest.fn();
    const stop = page.host.onInvitationsChange(listener);
    expect(heard).toHaveLength(1);
    page.addProjects(deps);
    expect(heard).toHaveLength(1);
    const list = [{ id: "i", title: "T", from: { fingerprint: "f" }, created: 1, expires: 2 }];
    heard[0]?.(list);
    expect(listener).toHaveBeenCalledWith(list);
    stop();
    expect(heard).toHaveLength(0);
  });
});
