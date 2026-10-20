import { createLoopbackTransport, type DetailsToHost, type HostToDetails, type DetailsTarget } from "@labshelf/core";
import { splitDetailsChannels } from "../../../src/library-page/details";

function setup(target: DetailsTarget = null) {
  const { ui, host } = createLoopbackTransport<DetailsToHost, HostToDetails>();
  const onFolderOpen = jest.fn();
  const channels = splitDetailsChannels(host, { current: () => target, onFolderOpen });
  const received: HostToDetails[] = [];
  ui.subscribe((m) => received.push(m));
  return { ui, channels, received, onFolderOpen };
}

describe("splitDetailsChannels", () => {
  it("unwraps each channel's messages and wraps the answers", () => {
    const { ui, channels, received } = setup();
    const lib: unknown[] = [];
    const proj: unknown[] = [];
    channels.library.subscribe((m) => lib.push(m));
    channels.projects.subscribe((m) => proj.push(m));
    ui.post({ channel: "library", msg: { type: "paper.details", id: "p1" } });
    ui.post({ channel: "projects", msg: { type: "detail", id: "x" } });
    expect(lib).toEqual([{ type: "paper.details", id: "p1" }]);
    expect(proj).toEqual([{ type: "detail", id: "x" }]);
    channels.library.post({ type: "notice", kind: "info", text: "hi" });
    expect(received).toEqual([{ channel: "library", msg: { type: "notice", kind: "info", text: "hi" } }]);
  });

  it("keeps folder.open from the host and reports the folder", () => {
    const { ui, channels, onFolderOpen } = setup();
    const lib: unknown[] = [];
    channels.library.subscribe((m) => lib.push(m));
    ui.post({ channel: "library", msg: { type: "folder.open", folder: "papers/ml" } });
    expect(onFolderOpen).toHaveBeenCalledWith("papers/ml");
    expect(lib).toEqual([]);
  });

  it("sends details.show with the current target after the channel's answer to ready", () => {
    const { ui, channels, received } = setup({ kind: "paper", ids: ["p1"] });
    channels.library.subscribe((m) => {
      if (m.type === "ready") queueMicrotask(() => channels.library.post({ type: "snapshot", snapshot: { folders: [], papers: [], pdfDirs: [], stats: {} } }));
    });
    ui.post({ channel: "library", msg: { type: "ready" } });
    expect(received).toEqual([]);
    return Promise.resolve().then(() => {
      expect(received.map((m) => ("type" in m ? m.type : m.msg.type))).toEqual(["snapshot", "details.show"]);
      expect(received[1]).toEqual({ type: "details.show", target: { kind: "paper", ids: ["p1"] } });
    });
  });
});
