// Tests the sharing channel: the message guards and the client talking to the server over a host.
import {
  isShareMessage, parseShareCall, parseShareReply, createShareClient, serveShare, type ShareCall, type ShareHost, type ShareOffers, type ShareReply,
} from "../../src/share/index";
import { createLoopbackTransport } from "../../src/libraryUi/protocol";
import type { ILogger } from "../../src/ports";

const call = (op: string, args: unknown, over: Record<string, unknown> = {}) => ({ channel: "sharing", type: "call", id: 1, op, args, ...over });

describe("parseSharingCall", () => {
  it("accepts a call with the op's arguments, a cancel and a hello", () => {
    expect(parseShareCall(call("projects", []))).toEqual(call("projects", []));
    expect(parseShareCall(call("shareFolder", ["papers/ml", true]))).not.toBeNull();
    expect(parseShareCall(call("openLink", ["https://example.org/x"]))).not.toBeNull();
    expect(parseShareCall({ channel: "sharing", type: "cancel", id: 3 })).not.toBeNull();
    expect(parseShareCall({ channel: "sharing", type: "hello" })).not.toBeNull();
  });

  it("rejects another channel, an unknown op and a bad id", () => {
    expect(parseShareCall(call("projects", [], { channel: "library" }))).toBeNull();
    expect(parseShareCall(call("toString", []))).toBeNull();
    expect(parseShareCall(call("projects", [], { id: -1 }))).toBeNull();
    expect(parseShareCall(call("projects", [], { id: 1.5 }))).toBeNull();
    expect(parseShareCall({ channel: "sharing", type: "cancel", id: "1" })).toBeNull();
    expect(parseShareCall(null)).toBeNull();
  });

  it("rejects the wrong arity and argument types", () => {
    expect(parseShareCall(call("projects", ["x"]))).toBeNull();
    expect(parseShareCall(call("projectStatus", []))).toBeNull();
    expect(parseShareCall(call("projectStatus", [""]))).toBeNull();
    expect(parseShareCall(call("projectStatus", ["a".repeat(4097)]))).toBeNull();
    expect(parseShareCall(call("shareFolder", ["papers/ml", "yes"]))).toBeNull();
    expect(parseShareCall(call("joinProject", [42]))).toBeNull();
    expect(parseShareCall(call("importLink", ["a".repeat(16385)]))).toBeNull();
    expect(parseShareCall(call("projects", "nope"))).toBeNull();
  });

  it("rejects folder paths outside papers and links that are not web addresses", () => {
    expect(parseShareCall(call("shareFolder", ["../etc", false]))).toBeNull();
    expect(parseShareCall(call("openFolder", ["papers/../x"]))).toBeNull();
    expect(parseShareCall(call("shareableFolder", ["notes"]))).toBeNull();
    expect(parseShareCall(call("openLink", ["javascript:alert(1)"]))).toBeNull();
    expect(parseShareCall(call("openLink", ["file:///etc/passwd"]))).toBeNull();
  });

  it("tells sharing messages apart from others", () => {
    expect(isShareMessage({ channel: "sharing", type: "bogus" })).toBe(true);
    expect(isShareMessage({ type: "ready" })).toBe(false);
    expect(isShareMessage("sharing")).toBe(false);
  });
});

describe("parseSharingReply", () => {
  const reply = (body: Record<string, unknown>) => ({ channel: "sharing", ...body });

  it("accepts results, progress, offers and dialog requests", () => {
    expect(parseShareReply(reply({ type: "result", id: 1, ok: true, value: [1] }))).not.toBeNull();
    expect(parseShareReply(reply({ type: "result", id: 1, ok: false, error: "no" }))).not.toBeNull();
    expect(parseShareReply(reply({ type: "progress", id: 1, progress: { stage: "uploading" } }))).not.toBeNull();
    expect(parseShareReply(reply({ type: "progress", id: 1, progress: { done: 1, total: 2 } }))).not.toBeNull();
    expect(parseShareReply(reply({ type: "offers", offers: { projects: true, links: false }, place: "this device" }))).not.toBeNull();
    expect(parseShareReply(reply({ type: "open", request: { kind: "shareFolder", path: "papers/ml" } }))).not.toBeNull();
    expect(parseShareReply(reply({ type: "open", request: { kind: "manageLinks" } }))).not.toBeNull();
  });

  it("rejects malformed replies", () => {
    expect(parseShareReply({ type: "result", id: 1, ok: true, value: 1 })).toBeNull();
    expect(parseShareReply(reply({ type: "result", id: 1, ok: false }))).toBeNull();
    expect(parseShareReply(reply({ type: "progress", id: 1, progress: { stage: "flying" } }))).toBeNull();
    expect(parseShareReply(reply({ type: "offers", offers: { projects: "yes", links: false }, place: "x" }))).toBeNull();
    expect(parseShareReply(reply({ type: "offers", offers: { projects: true, links: false } }))).toBeNull();
    expect(parseShareReply(reply({ type: "open", request: { kind: "explode" } }))).toBeNull();
    expect(parseShareReply(reply({ type: "open", request: { kind: "joinProject", invite: 7 } }))).toBeNull();
  });
});

function fakeHost(over: Partial<ShareHost> = {}): ShareHost & { setOffers(o: ShareOffers): void } {
  let offers: ShareOffers = { projects: true, links: false };
  const listeners = new Set<() => void>();
  const reject = () => Promise.reject(new Error("not faked"));
  return {
    place: "this device",
    offers: () => offers,
    onOffersChange: (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    setOffers(o) { offers = o; for (const l of listeners) l(); },
    projects: reject, projectStatus: reject, shareProject: reject, inviteLink: reject, joinProject: reject, leaveProject: reject,
    openProject: reject, shareableFolder: reject, shareFolder: reject, sharedLinks: reject, revokeLink: reject, importLink: reject,
    openFolder: reject, copyText: reject, openLink: reject,
    ...over,
  };
}

function fakeLogger() {
  const lines: unknown[][] = [];
  const logger: ILogger = {
    log: async (...args) => { lines.push(args); },
    error: async (...args) => { lines.push(["ERROR", ...args]); },
  };
  return { logger, lines };
}

function connect(host: ShareHost) {
  const pair = createLoopbackTransport<ShareCall, ShareReply>();
  const { logger, lines } = fakeLogger();
  const stop = serveShare(host, pair.host, logger);
  const client = createShareClient(pair.ui);
  return { client, lines, stop, pair };
}

describe("sharing client and server", () => {
  it("round-trips a value", async () => {
    const { client } = connect(fakeHost({ projects: async () => [{ id: "p", name: "Paper", shared: false }], copyText: async (t) => t === "hi" }));
    await expect(client.projects()).resolves.toEqual([{ id: "p", name: "Paper", shared: false }]);
    await expect(client.copyText("hi")).resolves.toBe(true);
  });

  it("turns a host error into a rejection with its message", async () => {
    const { client } = connect(fakeHost({ inviteLink: async () => { throw new Error("project is trashed"); } }));
    await expect(client.inviteLink("p")).rejects.toThrow("project is trashed");
  });

  it("routes progress to the call's callback", async () => {
    const host = fakeHost({
      shareFolder: async (_path, _ann, onProgress) => { onProgress({ stage: "reading" }); onProgress({ done: 1, total: 2 }); return { kind: "shared", link: "L" }; },
    });
    const { client } = connect(host);
    const seen: unknown[] = [];
    await expect(client.shareFolder("papers/ml", true, (p) => seen.push(p))).resolves.toEqual({ kind: "shared", link: "L" });
    expect(seen).toEqual([{ stage: "reading" }, { done: 1, total: 2 }]);
  });

  it("posts cancel on abort, which aborts the host's signal", async () => {
    let hostSignal: AbortSignal | undefined;
    const host = fakeHost({
      joinProject: (_invite, signal) => new Promise((_resolve, reject) => {
        hostSignal = signal;
        signal.addEventListener("abort", () => reject(new Error("cancelled")));
      }),
    });
    const { client, pair } = connect(host);
    const posted: unknown[] = [];
    pair.host.subscribe((m) => posted.push(m));
    const controller = new AbortController();
    const pending = client.joinProject("invite", controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(hostSignal?.aborted).toBe(true);
    expect(posted).toContainEqual(expect.objectContaining({ channel: "sharing", type: "cancel" }));
  });

  it("starts with no offers, then hears offers and place after hello and on each change", () => {
    const pair = createLoopbackTransport<ShareCall, ShareReply>();
    const client = createShareClient(pair.ui);
    expect(client.offers()).toEqual({ projects: false, links: false });
    const host = fakeHost();
    const changes: ShareOffers[] = [];
    client.onOffersChange(() => changes.push(client.offers()));
    serveShare(host, pair.host, fakeLogger().logger);
    expect(client.offers()).toEqual({ projects: true, links: false });
    expect(client.place).toBe("this device");
    host.setOffers({ projects: true, links: true });
    expect(changes).toEqual([{ projects: true, links: false }, { projects: true, links: true }]);
  });

  it("hands dialog requests to onOpen", () => {
    const pair = createLoopbackTransport<ShareCall, ShareReply>();
    const client = createShareClient(pair.ui);
    const requests: unknown[] = [];
    client.onOpen((r) => requests.push(r));
    pair.host.post({ channel: "sharing", type: "open", request: { kind: "joinProject", invite: "x" } });
    expect(requests).toEqual([{ kind: "joinProject", invite: "x" }]);
  });

  it("never logs invites or links on failure, and warns about malformed sharing messages", async () => {
    const secret = "labshelf://join#secret-key";
    const host = fakeHost({
      joinProject: async () => { throw new Error("relay unreachable"); },
      importLink: async () => { throw new Error("relay unreachable"); },
    });
    const { client, lines, pair } = connect(host);
    await expect(client.joinProject(secret, new AbortController().signal)).rejects.toThrow("relay unreachable");
    await expect(client.importLink(secret, () => {})).rejects.toThrow("relay unreachable");
    pair.ui.post({ channel: "sharing", type: "call", id: 99, op: "importLink", args: [secret, "extra"] } as never);
    pair.ui.post({ type: "ready" } as never);
    expect(JSON.stringify(lines)).not.toContain("secret-key");
    expect(lines.filter((l) => l[0] === "ERROR")).toHaveLength(2);
    expect(lines.filter((l) => l[0] === "WARN")).toHaveLength(1);
    expect(lines.every((l) => l[1] === "sharing")).toBe(true);
  });

  it("stops answering after dispose", () => {
    const host = fakeHost();
    const { client, stop } = connect(host);
    const changes: unknown[] = [];
    client.onOffersChange(() => changes.push(1));
    stop();
    host.setOffers({ projects: false, links: true });
    expect(changes).toEqual([]);
  });
});
