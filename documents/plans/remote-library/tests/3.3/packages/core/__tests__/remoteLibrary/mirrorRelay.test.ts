/** Verifies that the Mirror relay client calls the /mirror/* write routes with the owner secret as bearer and the bodies the contract names. */
import { createMirrorRelay } from "../../src/remoteLibrary/mirrorRelay";

interface Call { url: string; method: string; headers: Headers; body: unknown }

function fakeFetch(respond: () => Response = () => new Response("{}", { status: 200 })): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = (async (input: unknown, init?: RequestInit) => {
    const body = typeof init?.body === "string" && init.body !== "" ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(input), method: String(init?.method ?? "GET").toUpperCase(), headers: new Headers(init?.headers), body });
    return respond();
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

function relayWith(fetchImpl: typeof fetch) {
  return createMirrorRelay({ relayUrl: "https://relay.example.workers.dev", ownerSecret: "s3cret", deviceId: "device-a", fetch: fetchImpl });
}

describe("createMirrorRelay", () => {
  it("3.3a putOwner sends PUT /mirror/owner with the email and the owner secret as bearer", async () => {
    const { fetch: f, calls } = fakeFetch();
    await relayWith(f).putOwner("owner@example.com");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://relay.example.workers.dev/mirror/owner");
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].headers.get("authorization")).toBe("Bearer s3cret");
    expect(calls[0].body).toEqual({ email: "owner@example.com" });
  });

  it("3.3a putRows sends POST /mirror/rows with the put rows and the delete paths", async () => {
    const { fetch: f, calls } = fakeFetch();
    const row = { path: "index/papers.json", kind: "papers" as const, hash: "abc", size: 2, value: "{}" };
    await relayWith(f).putRows([row], ["papers/old/notes.qmd"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://relay.example.workers.dev/mirror/rows");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.get("authorization")).toBe("Bearer s3cret");
    expect(calls[0].body).toEqual({ put: [row], delete: ["papers/old/notes.qmd"] });
  });

  it("3.3a clear sends DELETE /mirror/rows with the owner secret", async () => {
    const { fetch: f, calls } = fakeFetch();
    await relayWith(f).clear();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://relay.example.workers.dev/mirror/rows");
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].headers.get("authorization")).toBe("Bearer s3cret");
  });

  it("3.3d lease posts the device id and the action to /mirror/lease", async () => {
    const { fetch: f, calls } = fakeFetch(() => new Response(JSON.stringify({ held: true }), { status: 200 }));
    await relayWith(f).lease("renew");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://relay.example.workers.dev/mirror/lease");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.get("authorization")).toBe("Bearer s3cret");
    expect(calls[0].body).toEqual({ deviceId: "device-a", action: "renew" });
  });

  it("3.3d lease answers true when the Mirror answers held true", async () => {
    const { fetch: f } = fakeFetch(() => new Response(JSON.stringify({ held: true }), { status: 200 }));
    expect(await relayWith(f).lease("acquire")).toBe(true);
  });

  it("3.3d lease answers false when the Mirror answers held false", async () => {
    const { fetch: f } = fakeFetch(() => new Response(JSON.stringify({ held: false }), { status: 200 }));
    expect(await relayWith(f).lease("acquire")).toBe(false);
  });

  it("3.3c putRows rejects when the Worker refuses the request, so the runner keeps only accepted batches", async () => {
    const { fetch: f } = fakeFetch(() => new Response(JSON.stringify({ error: "tooLarge" }), { status: 413 }));
    await expect(relayWith(f).putRows([{ path: "a.tex", kind: "source", hash: "h", size: 1, value: "a" }], [])).rejects.toBeDefined();
  });

  it("3.3a putOwner rejects when the Worker refuses the owner secret", async () => {
    const { fetch: f } = fakeFetch(() => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
    await expect(relayWith(f).putOwner("owner@example.com")).rejects.toBeDefined();
  });
});
