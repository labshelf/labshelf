/** Pins the Worker share client: endpoint paths, owner auth on writes, 404 as absent, and refusals as typed errors. */
import { createWorkerShareBackend, createWorkerShareReader, ShareRequestError } from "../../../src/share/index";

const relayUrl = "https://relay.someone.workers.dev/";
const id = "0123456789abcdef0123456789abcdef";
const hash = "a".repeat(64);

function fakeFetch(answer: () => Response) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const doFetch = (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return answer(); }) as typeof fetch;
  return { calls, doFetch };
}

describe("Worker share client", () => {
  it("writes with the owner secret to the share paths", async () => {
    const { calls, doFetch } = fakeFetch(() => new Response(null, { status: 204 }));
    const backend = createWorkerShareBackend({ relayUrl, ownerSecret: "s3cret", fetch: doFetch });
    await backend.putBlob(id, hash, new Uint8Array([1]));
    await backend.putManifest(id, new Uint8Array([2]));
    await backend.deleteBlob(id, hash);
    await backend.deleteManifest(id);
    expect(calls.map((call) => `${call.init?.method} ${call.url}`)).toEqual([
      `PUT https://relay.someone.workers.dev/share/${id}/blob/${hash}`,
      `PUT https://relay.someone.workers.dev/share/${id}/manifest`,
      `DELETE https://relay.someone.workers.dev/share/${id}/blob/${hash}`,
      `DELETE https://relay.someone.workers.dev/share/${id}/manifest`,
    ]);
    expect(calls.every((call) => (call.init?.headers as Record<string, string>)["authorization"] === "Bearer s3cret")).toBe(true);
  });

  it("asks HEAD for a stored blob", async () => {
    const present = fakeFetch(() => new Response(null, { status: 200 }));
    expect(await createWorkerShareBackend({ relayUrl, ownerSecret: "s", fetch: present.doFetch }).hasBlob(id, hash)).toBe(true);
    expect(present.calls[0]!.init?.method).toBe("HEAD");
    const absent = fakeFetch(() => new Response(null, { status: 404 }));
    expect(await createWorkerShareBackend({ relayUrl, ownerSecret: "s", fetch: absent.doFetch }).hasBlob(id, hash)).toBe(false);
  });

  it("turns a refusal into a typed error", async () => {
    const { doFetch } = fakeFetch(() => new Response(JSON.stringify({ v: "2.0", error: "unauthorized" }), { status: 401 }));
    const failure = createWorkerShareBackend({ relayUrl, ownerSecret: "bad", fetch: doFetch }).putManifest(id, new Uint8Array([1]));
    await expect(failure).rejects.toBeInstanceOf(ShareRequestError);
    await expect(failure).rejects.toMatchObject({ code: "unauthorized", status: 401 });
  });

  it("reads publicly and answers undefined for a missing share", async () => {
    const found = fakeFetch(() => new Response(new Uint8Array([7, 8]), { status: 200 }));
    const reader = createWorkerShareReader({ relayUrl, fetch: found.doFetch });
    expect(await reader.fetchBlob(id, hash)).toEqual(new Uint8Array([7, 8]));
    expect(found.calls[0]!.url).toBe(`https://relay.someone.workers.dev/share/${id}/blob/${hash}`);
    expect(found.calls[0]!.init?.headers).toBeUndefined();
    const missing = fakeFetch(() => new Response(JSON.stringify({ v: "2.0", error: "notFound" }), { status: 404 }));
    expect(await createWorkerShareReader({ relayUrl, fetch: missing.doFetch }).fetchManifest(id)).toBeUndefined();
  });
});
