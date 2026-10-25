/** Pins the folder-link half of the sharing host: which folders it shares, the relay check, the link list, revoke, import outcomes and opening folders. */
import { posixPathOps } from "../../../../src/library/index";
import type { PaperRecord } from "../../../../src/model/index";
import type { RelayAccount } from "../../../../src/relay/index";
import type { ImportShareLinkResult } from "../../../../src/share/index";
import type { ShareProgress } from "../../../../src/libraryUi/share/shareHost";
import { createFolderShareLinkOps, type FolderShareLinkDeps } from "../../../../src/libraryUi/share/flow/index";
import { makeHarness, PAPERS } from "../../../support/mutationHarness";
import { memoryShareRegistry, memoryShareRelay } from "../../../support/memoryShareRelay";

const account = { relayUrl: "https://relay.someone.workers.dev" } as RelayAccount;

function record(id: string, folder: string): PaperRecord {
  return { id, citeKey: id, title: `Title ${id}`, path: `${PAPERS}/${folder}/${id}` } as PaperRecord;
}

async function setup(overrides: Partial<FolderShareLinkDeps> = {}) {
  const h = makeHarness();
  const papers = [record("a", "Group"), record("b", "Group/Week 1")];
  for (const paper of papers) { await h.seedPaper(paper.path, { title: paper.title }); }
  const relay = memoryShareRelay();
  const opened: string[] = [];
  let refreshes = 0;
  const deps: FolderShareLinkDeps = {
    papers: () => papers, papersRoot: PAPERS, sep: "/",
    sources: { fs: h.fs, paths: posixPathOps, annotations: async () => [] },
    registry: memoryShareRegistry(),
    relay: { require: async () => account, connected: async () => account },
    backendFor: () => () => relay.backend,
    readerFor: () => relay.reader,
    importLink: async () => ({ status: "refused", error: "bad" }),
    refresh: async () => { refreshes += 1; },
    openFolder: async (path) => { opened.push(path); },
    ...overrides,
  };
  return { ops: createFolderShareLinkOps(deps, h.ctx.logger), relay, opened, refreshes: () => refreshes };
}

describe("createFolderLinkOps", () => {
  it("refuses a folder that holds no papers, without uploading", async () => {
    const { ops, relay } = await setup();
    expect(await ops.shareableFolder(`${PAPERS}/Empty`)).toBeUndefined();
    expect(await ops.shareableFolder(PAPERS)).toBeUndefined();
    await expect(ops.shareFolder(`${PAPERS}/Empty`, false, () => undefined)).rejects.toThrow("This folder holds no papers to share.");
    expect(relay.manifests.size).toBe(0);
  });

  it("answers noRelay when no relay is connected", async () => {
    const { ops, relay } = await setup({ relay: { require: async () => undefined, connected: async () => undefined } });
    expect(await ops.shareFolder(`${PAPERS}/Group`, false, () => undefined)).toEqual({ kind: "noRelay" });
    expect(relay.manifests.size).toBe(0);
  });

  it("shares an eligible folder, reports its stages and lists the link", async () => {
    const { ops } = await setup();
    expect(await ops.shareableFolder(`${PAPERS}/Group`)).toEqual({ path: `${PAPERS}/Group`, label: "Group", count: 2 });
    const progress: ShareProgress[] = [];
    const result = await ops.shareFolder(`${PAPERS}/Group`, false, (p) => progress.push(p));
    expect(result.kind).toBe("shared");
    expect(progress).toEqual([{ stage: "reading" }, { stage: "encrypting" }, { stage: "uploading" }]);
    const links = await ops.sharedLinks();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ folder: "Group", relayHost: "relay.someone.workers.dev" });
    expect(result.kind === "shared" && links[0]?.link).toBe(result.kind === "shared" && result.link);
  });

  it("revokes a listed link once", async () => {
    const { ops, relay } = await setup();
    await ops.shareFolder(`${PAPERS}/Group`, false, () => undefined);
    const [link] = await ops.sharedLinks();
    expect(await ops.revokeLink(link!.id)).toBe(true);
    expect(relay.manifests.size).toBe(0);
    expect(await ops.revokeLink(link!.id)).toBe(false);
    expect(await ops.sharedLinks()).toEqual([]);
  });

  it("words a refused or unopenable link as a failure", async () => {
    const refused = await setup();
    expect(await refused.ops.importLink("x", () => undefined)).toEqual({ kind: "failed", message: "LabShelf could not read that share link. (bad)" });
    const removed = await setup({ importLink: async () => ({ status: "openFailed", error: "removed" }) });
    expect(await removed.ops.importLink("x", () => undefined)).toEqual({ kind: "failed", message: "This link was removed by the person who shared it." });
    expect(refused.refreshes() + removed.refreshes()).toBe(0);
  });

  it("refreshes after an import that added papers and reports progress", async () => {
    const summary = { folder: `${PAPERS}/Group 2`, added: [record("c", "Group 2")], duplicates: [], missingPdfs: [] };
    const result: ImportShareLinkResult = { status: "imported", summary, withAnnotations: false };
    const s = await setup({ importLink: async ({ onProgress }) => { onProgress?.(1, 1); return result; } });
    const progress: ShareProgress[] = [];
    expect(await s.ops.importLink("x", (p) => progress.push(p))).toEqual({
      kind: "imported", summary: 'Imported 1 of the shared papers into "Group 2".', folder: `${PAPERS}/Group 2`,
    });
    expect(progress).toEqual([{ done: 1, total: 1 }]);
    expect(s.refreshes()).toBe(1);
  });

  it("does not refresh when every shared paper was already there", async () => {
    const summary = { added: [], duplicates: [{ title: "T", existingId: "a" }], missingPdfs: [] };
    const s = await setup({ importLink: async () => ({ status: "imported", summary, withAnnotations: false }) });
    expect(await s.ops.importLink("x", () => undefined)).toEqual({ kind: "imported", summary: "Every shared paper is already in your library.", folder: undefined });
    expect(s.refreshes()).toBe(0);
  });

  it("opens folders of the library only", async () => {
    const { ops, opened } = await setup();
    await ops.openFolder(PAPERS);
    await ops.openFolder(`${PAPERS}/Group`);
    await expect(ops.openFolder("/etc")).rejects.toThrow();
    await expect(ops.openFolder(`${PAPERS}-other`)).rejects.toThrow();
    expect(opened).toEqual([PAPERS, `${PAPERS}/Group`]);
  });
});
