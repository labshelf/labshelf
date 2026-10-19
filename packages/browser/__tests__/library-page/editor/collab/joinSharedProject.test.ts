/**
 * @jest-environment node
 */
// Joining a shared project over a relay: the project folder fills with the share's text files, and a share that is not a project is refused.
const local: Record<string, unknown> = {};
jest.mock("../../../../src/platform", () => ({
  bx: { storage: { local: {
    get: async (key: string) => (key in local ? { [key]: JSON.parse(JSON.stringify(local[key])) } : {}),
    set: async (items: Record<string, unknown>) => { Object.assign(local, JSON.parse(JSON.stringify(items))); },
  } } },
}));

import {
  createProjectIndex, createShareSession, deriveContentKey, deriveShareId, fileText, formatInvite, indexFiles, indexSettings,
  type ILogger, type RelayTransport, type ShareSession,
} from "@labshelf/core";
import * as Y from "yjs";
import { joinSharedProject, loadShare, UnknownShareKindError, type ShareConnection } from "../../../../src/library-page/editor/collab";
import { fakeRelay, loopback } from "../../../support/loopbackRelay";
import { memoryLibraryFs } from "../../../support/memoryLibraryFs";

const SHARE_KEY = new Uint8Array(16).fill(3);
const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

async function until(done: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 400 && !(await done()); i++) { await new Promise((resolve) => setTimeout(resolve, 5)); }
  expect(await done()).toBe(true);
}

describe("joinSharedProject", () => {
  let owner: ShareSession;
  let connection: ShareConnection | undefined;
  let createTransport: () => RelayTransport;
  let inviteText: string;
  beforeEach(async () => {
    const join = loopback();
    const shareId = await deriveShareId(SHARE_KEY);
    owner = createShareSession({ shareId, contentKey: await deriveContentKey(SHARE_KEY), transport: join("owner"), logger });
    createTransport = () => fakeRelay(join("joiner"));
    inviteText = `Join me: ${await formatInvite({ shareKey: SHARE_KEY, relays: [{ url: "https://relay.test" }] })}.`;
  });
  afterEach(async () => { await connection?.close(); connection = undefined; await owner.close(); });

  it("creates the project folder with the share's text files and keeps the share key and relays", async () => {
    Y.transact(owner.index, () => {
      createProjectIndex(owner.index);
      indexSettings(owner.index).set("title", "Draft");
      indexFiles(owner.index).set("main.tex", { kind: "text" });
      indexFiles(owner.index).set("figure.png", { kind: "blob", hash: "0".repeat(64) });
    });
    fileText(owner.openDoc("main.tex")).insert(0, "\\documentclass{article}");
    const fs = memoryLibraryFs();
    const joined = await joinSharedProject({ inviteText, fs, logger, createTransport });
    connection = joined.connection;
    expect(joined).toMatchObject({ projectId: "draft", folder: "projects/draft" });
    expect(await fs.readText("projects/draft/labshelf.yaml")).toContain("shared: ");
    await until(async () => (await fs.exists("projects/draft/main.tex")) && (await fs.readText("projects/draft/main.tex")) === "\\documentclass{article}");
    expect(await fs.exists("projects/draft/figure.png")).toBe(false);
    expect(await loadShare(await deriveShareId(SHARE_KEY))).toEqual({ shareKey: SHARE_KEY, relays: [{ url: "https://relay.test" }] });
  });

  it("refuses a share of a kind this version does not know", async () => {
    Y.transact(owner.index, () => {
      owner.index.getMap("share").set("kind", "notebook");
      indexSettings(owner.index).set("title", "Notes");
    });
    await expect(joinSharedProject({ inviteText, fs: memoryLibraryFs(), logger, createTransport })).rejects.toBeInstanceOf(UnknownShareKindError);
  });

  it("refuses text that holds no invite", async () => {
    await expect(joinSharedProject({ inviteText: "hello", fs: memoryLibraryFs(), logger, createTransport })).rejects.toThrow("notAnInvite");
  });
});
