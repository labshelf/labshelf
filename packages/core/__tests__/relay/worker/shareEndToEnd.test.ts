/** Pins the share client against the real Worker handler: build, upload, open, read a PDF, revoke, and the link reads as removed. */
import type { ILogger } from "../../../src/ports/index";
import worker from "../../../src/relay/worker/index";
import {
  buildShare, createWorkerShareBackend, createWorkerShareReader, openShare, revokeShare, uploadShare, type ShareRegistryStore,
} from "../../../src/share/index";
import { fakeEnv, OWNER_SECRET } from "./fakeRoomRuntime";

const relayUrl = "https://relay.someone.workers.dev";
const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };

describe("share over the relay Worker", () => {
  it("uploads, opens, reads a PDF and revokes", async () => {
    const { env } = fakeEnv();
    const workerFetch = ((input: RequestInfo | URL, init?: RequestInit) => worker.fetch(new Request(input, init), env)) as typeof fetch;
    const store: ShareRegistryStore & { text?: string } = {
      read: async () => store.text, write: async (text) => { store.text = text; },
    };
    const pdf = new Uint8Array(3000).map((_, index) => (index * 7) % 251);
    const share = await buildShare({
      folderName: "Reading group", withAnnotations: false,
      papers: [{ metadata: { id: "a", title: "A", citeKey: "a" }, pdf }],
    });
    const backend = createWorkerShareBackend({ relayUrl, ownerSecret: OWNER_SECRET, fetch: workerFetch });
    const link = await uploadShare({ share, relayUrl, backend, registry: store, logger });

    const readerFor = () => createWorkerShareReader({ relayUrl, fetch: workerFetch });
    const opened = await openShare(link, readerFor);
    if (!opened.ok) { throw new Error(`openShare failed: ${opened.error}`); }
    expect(opened.share.manifest.folder).toBe("Reading group");
    const loaded = await opened.share.loadPdf(opened.share.manifest.papers[0]!);
    expect(loaded).toEqual({ ok: true, bytes: pdf });

    expect(await revokeShare(share.shareId, { registry: store, backendFor: () => backend, logger })).toBe(true);
    expect(await openShare(link, readerFor)).toEqual({ ok: false, error: "removed" });
  });

  it("refuses an upload made with the wrong owner secret", async () => {
    const { env } = fakeEnv();
    const workerFetch = ((input: RequestInfo | URL, init?: RequestInit) => worker.fetch(new Request(input, init), env)) as typeof fetch;
    const backend = createWorkerShareBackend({ relayUrl, ownerSecret: "wrong", fetch: workerFetch });
    await expect(backend.putManifest("0123456789abcdef0123456789abcdef", new Uint8Array(3))).rejects.toMatchObject({ code: "unauthorized", status: 401 });
  });
});
