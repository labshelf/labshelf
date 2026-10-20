/**
 * @jest-environment node
 */
// The page keeps one connection per shared project: joining opens it, a reload reconnects from the stored key and relays, and closing drops them all.
const local: Record<string, unknown> = {};
jest.mock("../../../../src/platform", () => ({
  bx: { storage: { local: {
    get: async (key: string) => (key in local ? { [key]: JSON.parse(JSON.stringify(local[key])) } : {}),
    set: async (items: Record<string, unknown>) => { Object.assign(local, JSON.parse(JSON.stringify(items))); },
  } } },
}));

import {
  createProjectIndex, createShareSession, deriveContentKey, deriveShareId, formatInvite, indexFiles, indexSettings,
  type ILogger, type ShareSession,
} from "@labshelf/core";
import * as Y from "yjs";
import { createPageShares, type PageShares } from "../../../../src/library-page/editor/collab";
import { fakeRelay, loopback } from "../../../support/loopbackRelay";
import { memoryLibraryFs } from "../../../support/memoryLibraryFs";

const SHARE_KEY = new Uint8Array(16).fill(5);
const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

describe("createPageShares", () => {
  let owner: ShareSession;
  let shares: PageShares;
  let createTransport: jest.Mock;
  let shareId: string;
  let inviteText: string;
  beforeEach(async () => {
    for (const key of Object.keys(local)) delete local[key];
    const join = loopback();
    shareId = await deriveShareId(SHARE_KEY);
    owner = createShareSession({ shareId, contentKey: await deriveContentKey(SHARE_KEY), transport: join("owner"), logger });
    Y.transact(owner.index, () => {
      createProjectIndex(owner.index);
      indexSettings(owner.index).set("title", "Draft");
      indexFiles(owner.index).set("main.tex", { kind: "text" });
    });
    createTransport = jest.fn(() => fakeRelay(join(`joiner-${createTransport.mock.calls.length}`)));
    shares = createPageShares({ fs: memoryLibraryFs(), libraryId: async () => "browser", logger, createTransport });
    inviteText = await formatInvite({ shareKey: SHARE_KEY, relays: [{ url: "https://relay.test" }] });
  });
  afterEach(async () => { await shares.closeAll(); await owner.close(); });

  it("opens the joined project's connection and tells listeners", async () => {
    const listener = jest.fn();
    shares.onChange(listener);
    const { projectId, folder } = await shares.join(inviteText);
    expect({ projectId, folder }).toEqual({ projectId: "draft", folder: "projects/draft" });
    const active = shares.active("draft");
    expect(active?.session.index).toBeDefined();
    expect(active?.comments).toBeDefined();
    expect(shares.active("other")).toBeUndefined();
    expect(listener).toHaveBeenCalled();
  });

  it("reconnects a project after a reload from the stored key and relays, once", async () => {
    await shares.join(inviteText);
    await shares.closeAll();
    expect(shares.active("draft")).toBeUndefined();
    await shares.connect("draft", shareId, "projects/draft");
    await shares.connect("draft", shareId, "projects/draft");
    expect(shares.active("draft")).toBeDefined();
    expect(createTransport).toHaveBeenCalledTimes(2);
    expect(createTransport.mock.calls[1][0]).toMatchObject({ relayUrl: "https://relay.test", shareId });
  });

  it("refuses to connect a share whose key was never stored", async () => {
    await expect(shares.connect("draft", "f".repeat(32), "projects/draft")).rejects.toThrow("f".repeat(32));
    expect(shares.active("draft")).toBeUndefined();
  });

  it("uses the display name it is given for comments", async () => {
    expect(shares.name()).toBe("Guest");
    await shares.setName("Ada");
    expect(shares.name()).toBe("Ada");
  });
});
