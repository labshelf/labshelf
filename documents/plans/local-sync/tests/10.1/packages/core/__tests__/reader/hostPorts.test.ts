// Tests the reader's consult plumbing on the host side: the protocol guard for the consult command, the init hasConsult flag and the controller's
// dispatch of consult messages to the optional ReaderConsultPort (dropped without a port, a rejection logged and not thrown).
import { isWebviewMessage } from "../../src/reader/protocol/index";
import type { HostToWebview } from "@labshelf/core";
import type { ReaderConsultPort } from "../../src/reader/hostPorts";
import { setupHost } from "./hostFixture";

const OUTBOUND = {
  list: { type: "consult", id: 1, request: { kind: "list", what: "manuscript" } },
  open: { type: "consult", id: 2, request: { kind: "open", ref: { kind: "paper", paperId: "p1" } } },
  paperPdf: { type: "consult", id: 3, request: { kind: "paperPdf", paperId: "p1" } },
  browse: { type: "consult", id: 4, request: { kind: "browse" } },
  file: { type: "consultFile", id: 5, key: "k1", ref: { kind: "manuscript", projectId: "pr", path: "main.qmd" } },
  docPush: { type: "consultDoc", key: "k1", message: { type: "push", version: 2, updates: [] } },
  docSave: { type: "consultDoc", key: "k1", message: { type: "save" } },
  release: { type: "consultRelease", key: "k1" },
} as const;

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const send = async (host: { handle(m: never): Promise<void> | void }, message: unknown) => {
  await host.handle(message as never);
  await settle();
};

function setup(consult?: ReaderConsultPort) {
  const base = setupHost();
  if (consult) { Object.assign(base.ports, { consult }); }
  const init = () => base.posted.find((m: HostToWebview) => m.type === "init") as { hasConsult?: boolean } | undefined;
  return { ...base, init };
}

describe("reader consult: protocol guard", () => {
  it.each(Object.entries(OUTBOUND))("10.1a accepts a consult command carrying the %s message", (_name, message) => {
    expect(isWebviewMessage({ command: "consult", message })).toBe(true);
  });

  it("10.1a rejects a consult command without a message", () => {
    expect(isWebviewMessage({ command: "consult" })).toBe(false);
  });

  it("10.1a rejects a consult command whose message has an unknown type", () => {
    expect(isWebviewMessage({ command: "consult", message: { type: "consultWhatever", id: 1 } })).toBe(false);
  });

  it("10.1a rejects a consult command whose message is not an object", () => {
    expect(isWebviewMessage({ command: "consult", message: "consult" })).toBe(false);
    expect(isWebviewMessage({ command: "consult", message: null })).toBe(false);
  });

  it("10.1a rejects a consult command whose request is malformed", () => {
    expect(isWebviewMessage({ command: "consult", message: { type: "consult", id: 1, request: { kind: "list", what: "bogus" } } })).toBe(false);
    expect(isWebviewMessage({ command: "consult", message: { type: "consult", id: "1", request: { kind: "browse" } } })).toBe(false);
  });

  it("10.1a rejects a consult command whose document message is malformed", () => {
    expect(isWebviewMessage({ command: "consult", message: { type: "consultDoc", key: "k1", message: { type: "nope" } } })).toBe(false);
    expect(isWebviewMessage({ command: "consult", message: { type: "consultRelease" } })).toBe(false);
  });
});

describe("reader consult: host controller", () => {
  it("10.1b init carries hasConsult: true when the host has a consult port", async () => {
    const { host, init } = setup({ handle: jest.fn(async () => undefined) });
    await send(host, { command: "ready-for-init" });
    expect(init()?.hasConsult).toBe(true);
  });

  it("10.1b init does not carry hasConsult without a consult port", async () => {
    const { host, init } = setup();
    await send(host, { command: "ready-for-init" });
    expect(init()).toBeDefined();
    expect(init()?.hasConsult ?? false).toBe(false);
  });

  it.each(Object.entries(OUTBOUND))("10.1b a consult command with the %s message reaches ports.consult.handle with that message", async (_name, message) => {
    const handle = jest.fn(async (_message: unknown) => undefined);
    const { host } = setup({ handle });
    await send(host, { command: "consult", message });
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith(message);
  });

  it("10.1b hands each consult command to the port in the order received", async () => {
    const handle = jest.fn(async (_message: unknown) => undefined);
    const { host } = setup({ handle });
    await send(host, { command: "consult", message: OUTBOUND.list });
    await send(host, { command: "consult", message: OUTBOUND.release });
    expect(handle.mock.calls.map(([m]) => (m as { type: string }).type)).toEqual(["consult", "consultRelease"]);
  });

  it("10.1b without a consult port the command is dropped without throwing and posts nothing", async () => {
    const { host, posted } = setup();
    await expect(host.handle({ command: "consult", message: OUTBOUND.list } as never)).resolves.toBeUndefined();
    await settle();
    expect(posted).toEqual([]);
  });

  it("10.1b a rejecting port is logged and does not make the controller throw", async () => {
    const handle = jest.fn(async (_message: unknown) => { throw new Error("consult boom"); });
    const { host, ports } = setup({ handle });
    await expect(host.handle({ command: "consult", message: OUTBOUND.list } as never)).resolves.toBeUndefined();
    await settle();
    expect(handle).toHaveBeenCalledTimes(1);
    expect(ports.logger.error).toHaveBeenCalledTimes(1);
  });
});
