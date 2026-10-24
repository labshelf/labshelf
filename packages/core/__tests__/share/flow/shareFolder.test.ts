/** Pins sharing a folder as a link: its nested papers, annotations only when chosen, the stages and the listed share. */
import { posixPathOps } from "../../../src/library/index";
import type { Annotation, PaperRecord } from "../../../src/model/index";
import { loadShareRegistry, openShare, shareFolderAsLink, type ShareFolderStage } from "../../../src/share/index";
import { makeHarness, PAPERS } from "../../support/mutationHarness";
import { memoryShareRegistry, memoryShareRelay } from "../../support/memoryShareRelay";

const relayUrl = "https://relay.someone.workers.dev";
const annotation = { id: "n1", paperId: "a", type: "note", pageNumber: 1, content: "x" } as Annotation;

function record(id: string, folder: string): PaperRecord {
  return { id, citeKey: id, title: `Title ${id}`, path: `${PAPERS}/${folder}/${id}` } as PaperRecord;
}

async function share(withAnnotations: boolean) {
  const h = makeHarness();
  const papers = [record("a", "Group"), record("b", "Group/Week 1"), record("c", "Other")];
  for (const paper of papers) { await h.seedPaper(paper.path, { title: paper.title }); }
  const relay = memoryShareRelay();
  const registry = memoryShareRegistry();
  const stages: ShareFolderStage[] = [];
  const link = await shareFolderAsLink({
    papers, folder: `${PAPERS}/Group`, withAnnotations, relayUrl, registry, logger: h.ctx.logger,
    sources: { fs: h.fs, paths: posixPathOps, annotations: async (id) => (id === "a" ? [annotation] : []) },
    backendFor: () => relay.backend, onStage: (stage) => stages.push(stage),
  });
  const opened = await openShare(link, () => relay.reader);
  if (!opened.ok) { throw new Error(`openShare failed: ${opened.error}`); }
  return { stages, manifest: opened.share.manifest, registry };
}

describe("shareFolderAsLink", () => {
  it("uploads the folder's papers at any depth with their annotations, and lists the share", async () => {
    const { stages, manifest, registry } = await share(true);
    expect(manifest.folder).toBe("Group");
    expect(manifest.papers.map((paper) => paper.metadata.id)).toEqual(["a", "b"]);
    expect(manifest.papers[0]?.annotations).toEqual([annotation]);
    expect(manifest.papers[0]?.pdf).toBeDefined();
    expect(stages).toEqual(["reading", "encrypting", "uploading"]);
    expect((await loadShareRegistry(registry)).shares).toHaveLength(1);
  });

  it("leaves the annotations out when the share is made without them", async () => {
    const { manifest } = await share(false);
    expect(manifest.papers.every((paper) => paper.annotations === undefined)).toBe(true);
  });
});
