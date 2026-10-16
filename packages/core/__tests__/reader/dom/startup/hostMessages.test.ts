// Checks how the reader applies a host's changed regions around a reload.
import type { HostToWebview } from "../../../../src/reader/protocol";
import { bindHostMessages, type HostMessageTargets } from "../../../../src/reader/dom/startup/hostMessages";

type Handler = (msg: HostToWebview) => void;

function setup() {
  const handlers = new Map<string, Handler>();
  const order: string[] = [];
  const changeMarks = { show: jest.fn((areas: unknown[]) => order.push(`show:${areas.length}`)) };
  const reloader = { reload: jest.fn(() => { order.push("reload"); return Promise.resolve(); }) };
  const targets = {
    ctx: { host: { on: (type: string, handler: Handler) => handlers.set(type, handler) } },
    ui: { buildBanner: { showReloadError: jest.fn() } },
    reloader,
    changeMarks,
  } as unknown as HostMessageTargets;
  bindHostMessages(targets);
  const send = (msg: HostToWebview) => handlers.get(msg.type)!(msg);
  return { send, changeMarks, order };
}

describe("bindHostMessages", () => {
  it("shows the regions a host marks as changed", () => {
    const { send, changeMarks } = setup();
    const areas = [{ page: 2, left: 1, top: 2, right: 3, bottom: 4 }];
    send({ type: "showChanges", areas });
    expect(changeMarks.show).toHaveBeenCalledWith(areas);
  });

  it("clears the marks before a reload, so marks sent after the request stay on the reloaded document", () => {
    const { send, order } = setup();
    send({ type: "showChanges", areas: [{ page: 1, left: 0, top: 0, right: 1, bottom: 1 }] });
    send({ type: "reloadDocument" });
    send({ type: "showChanges", areas: [{ page: 1, left: 0, top: 0, right: 1, bottom: 1 }] });
    expect(order).toEqual(["show:1", "show:0", "reload", "show:1"]);
  });
});
