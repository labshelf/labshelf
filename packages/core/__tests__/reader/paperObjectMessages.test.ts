/** The reader answers paperObjects through the host's port, and with "From paper is not available here." without one. */
import { paperObjectHandlers } from "../../src/reader/paperObjectMessages";
import type { HostContext, ReaderHostPorts } from "../../src/reader/hostPorts";
import type { PaperObjectsPort, PaperObjectsRequest } from "../../src/paperObjects/index";
import type { HostToWebview } from "../../src/reader/protocol/index";

const request: PaperObjectsRequest = { type: "paperObjects.request", requestId: "r1", call: { op: "list", paperId: "p1" } };
const answer = (ports: Pick<ReaderHostPorts, "paperObjects" | "post">) =>
  paperObjectHandlers.paperObjects({ ports } as unknown as HostContext, { command: "paperObjects", request });
const OBJECT = { kind: "equation", label: "3", page: 1, box: { x: 0.1, y: 0.2, w: 0.5, h: 0.05 }, caption: "E = mc^2" } as const;

describe("paperObjectHandlers.paperObjects", () => {
  it("posts the port's answer", async () => {
    const posted: HostToWebview[] = [];
    const list = jest.fn(async () => [OBJECT]);
    await answer({ paperObjects: { list } as unknown as PaperObjectsPort, post: (m) => { posted.push(m); } });
    expect(list).toHaveBeenCalledWith("p1");
    expect(posted).toEqual([{ type: "paperObjects.reply", requestId: "r1", value: [OBJECT] }]);
  });

  it("posts the port's rejection as the reply's error", async () => {
    const posted: HostToWebview[] = [];
    const list = async () => { throw new Error("This paper has no PDF."); };
    await answer({ paperObjects: { list } as unknown as PaperObjectsPort, post: (m) => { posted.push(m); } });
    expect(posted).toEqual([{ type: "paperObjects.reply", requestId: "r1", error: "This paper has no PDF." }]);
  });

  it("answers that From paper is not available without a port", async () => {
    const posted: HostToWebview[] = [];
    await answer({ post: (m) => { posted.push(m); } });
    expect(posted).toEqual([{ type: "paperObjects.reply", requestId: "r1", error: "From paper is not available here." }]);
  });
});
