import { createLoopbackTransport } from "../../../src/library-ui/protocol";
import { createSharingClient, serveSharing, type SharingCall, type SharingHost, type SharingOffers, type SharingReply } from "../../../src/library-ui/sharing";
import type { ILogger } from "../../../src/ports";

function fakeHost(over: Partial<SharingHost> = {}): SharingHost & { setOffers(o: SharingOffers): void } {
  let offers: SharingOffers = { projects: true, links: false };
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

function connect(host: SharingHost) {
  const pair = createLoopbackTransport<SharingCall, SharingReply>();
  const { logger, lines } = fakeLogger();
  const stop = serveSharing(host, pair.host, logger);
  const client = createSharingClient(pair.ui);
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
    const pair = createLoopbackTransport<SharingCall, SharingReply>();
    const client = createSharingClient(pair.ui);
    expect(client.offers()).toEqual({ projects: false, links: false });
    const host = fakeHost();
    const changes: SharingOffers[] = [];
    client.onOffersChange(() => changes.push(client.offers()));
    serveSharing(host, pair.host, fakeLogger().logger);
    expect(client.offers()).toEqual({ projects: true, links: false });
    expect(client.place).toBe("this device");
    host.setOffers({ projects: true, links: true });
    expect(changes).toEqual([{ projects: true, links: false }, { projects: true, links: true }]);
  });

  it("hands dialog requests to onOpen", () => {
    const pair = createLoopbackTransport<SharingCall, SharingReply>();
    const client = createSharingClient(pair.ui);
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
