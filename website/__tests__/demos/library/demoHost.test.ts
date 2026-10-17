// Pins the demo host's answers to ready, paper.details and a status change over the in-memory demo library.
import { createLoopbackTransport, type HostToUi } from "@labshelf/core";

import { APP_ONLY_NOTICE, attachDemoHost, createDemoLibrary, type DemoData } from "../../../src/demos/library/index";

const META = "title: Chain-of-Thought Prompting\ncitekey: wei2022\nstatus: reading\ntags:\n  - prompting\n";
const DIR = "papers/Language models/wei2022";
const data: DemoData = {
  files: [
    { path: `${DIR}/metadata.yaml`, size: 80, modified: "2026-09-01T00:00:00.000Z" },
    { path: `${DIR}/paper.pdf`, size: 891773, modified: "2026-09-01T00:00:00.000Z" },
  ],
  metadata: { [DIR]: META },
  sidecars: { wei2022: { annotations: [], reading: { page: 2, updatedAt: "2026-09-21T08:44:00.000Z" } } },
};
const silent = { log: async () => undefined, error: async () => undefined };

function connect(): { sent: HostToUi[]; post: ReturnType<typeof createLoopbackTransport>["ui"]["post"] } {
  const { ui, host } = createLoopbackTransport();
  attachDemoHost(host, createDemoLibrary(data, () => "2026-10-17T12:00:00.000Z"), silent);
  const sent: HostToUi[] = [];
  ui.subscribe((m) => sent.push(m));
  return { sent, post: ui.post };
}
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("demo library host", () => {
  it("answers ready with the root folder and a snapshot built from metadata.yaml", async () => {
    const { sent, post } = connect();
    post({ type: "ready" });
    await settle();
    expect(sent[0]).toEqual({ type: "navigate", folder: "papers" });
    expect(sent[1]).toMatchObject({
      type: "snapshot",
      snapshot: {
        folders: [{ name: "Language models", path: "papers/Language models", children: [] }],
        papers: [{ id: "wei2022", title: "Chain-of-Thought Prompting", path: DIR, status: "reading", tags: ["prompting"], hasPdf: true }],
        pdfDirs: [DIR],
        stats: { wei2022: { annotations: 0, lastPage: 2 } },
      },
    });
  });

  it("answers paper.details with the sidecar's reading position and the PDF below the library root", async () => {
    const { sent, post } = connect();
    post({ type: "paper.details", id: "wei2022" });
    await settle();
    expect(sent).toEqual([{
      type: "details", id: "wei2022",
      details: { annotations: [], reading: { page: 2, updatedAt: "2026-09-21T08:44:00.000Z" }, pdf: { size: 891773, relPath: "Language models/wei2022/paper.pdf" } },
    }]);
  });

  it("keeps a status change in memory and answers with a snapshot that carries it", async () => {
    const { sent, post } = connect();
    post({ type: "paper.setStatus", ids: ["wei2022"], status: "done" });
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "snapshot", snapshot: { papers: [{ status: "done", statusChangedAt: "2026-10-17T12:00:00.000Z" }] } });
  });

  it("answers an app-only action with a notice", async () => {
    const { sent, post } = connect();
    post({ type: "paper.open", id: "wei2022" });
    await settle();
    expect(sent).toEqual([{ type: "notice", kind: "info", text: APP_ONLY_NOTICE }]);
  });
});
