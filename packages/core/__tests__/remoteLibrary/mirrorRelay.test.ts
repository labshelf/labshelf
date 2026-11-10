/** Verifies that the Mirror relay client calls the /mirror/* write routes with the owner secret as bearer and the bodies the contract names. */
import { createMirrorRelay, MirrorRefusal } from "../../src/remoteLibrary/mirrorRelay";

interface Call { url: string; method: string; headers: Headers; body: unknown; raw: unknown }

function fakeFetch(respond: () => Response = () => new Response("{}", { status: 200 })): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = (async (input: unknown, init?: RequestInit) => {
    const body = typeof init?.body === "string" && init.body !== "" ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(input), method: String(init?.method ?? "GET").toUpperCase(), headers: new Headers(init?.headers), body, raw: init?.body });
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
    const call = calls[0]!;
    expect(call.url).toBe("https://relay.example.workers.dev/mirror/owner");
    expect(call.method).toBe("PUT");
    expect(call.headers.get("authorization")).toBe("Bearer s3cret");
    expect(call.body).toEqual({ email: "owner@example.com" });
  });

  it("3.3a putRows sends POST /mirror/rows with the put rows and the delete paths", async () => {
    const { fetch: f, calls } = fakeFetch();
    const row = { path: "index/papers.json", kind: "papers" as const, hash: "abc", size: 2, value: "{}" };
    await relayWith(f).putRows([row], ["papers/old/notes.qmd"]);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://relay.example.workers.dev/mirror/rows");
    expect(call.method).toBe("POST");
    expect(call.headers.get("authorization")).toBe("Bearer s3cret");
    expect(call.body).toEqual({ put: [row], delete: ["papers/old/notes.qmd"] });
  });

  it("3.3a clear sends DELETE /mirror/rows with the owner secret", async () => {
    const { fetch: f, calls } = fakeFetch();
    await relayWith(f).clear();
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://relay.example.workers.dev/mirror/rows");
    expect(call.method).toBe("DELETE");
    expect(call.headers.get("authorization")).toBe("Bearer s3cret");
  });

  it("3.3d lease posts the device id and the action to /mirror/lease", async () => {
    const { fetch: f, calls } = fakeFetch(() => new Response(JSON.stringify({ held: true }), { status: 200 }));
    await relayWith(f).lease("renew");
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://relay.example.workers.dev/mirror/lease");
    expect(call.method).toBe("POST");
    expect(call.headers.get("authorization")).toBe("Bearer s3cret");
    expect(call.body).toEqual({ deviceId: "device-a", action: "renew" });
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

  const STATUS = { v: 1, generation: "g1", store: "do", used: 10, limit: 5_000_000_000, includePdfs: false, rows: 2, edits: 1, r2: { bound: false, month: "2026-11", operations: 0 } };
  const json = (value: unknown, status = 200) => () => new Response(JSON.stringify(value), { status });

  it("putFile sends the raw bytes to PUT /mirror/file/<path> with the kind and hash headers, each segment encoded", async () => {
    const { fetch: f, calls } = fakeFetch();
    const bytes = new Uint8Array([1, 2, 3]);
    await relayWith(f).putFile("projects/my thesis/fig#1.png", "asset", "abc", bytes);
    const call = calls[0]!;
    expect(call.url).toBe("https://relay.example.workers.dev/mirror/file/projects/my%20thesis/fig%231.png");
    expect(call.method).toBe("PUT");
    expect(call.headers.get("authorization")).toBe("Bearer s3cret");
    expect(call.headers.get("x-labshelf-kind")).toBe("asset");
    expect(call.headers.get("x-labshelf-hash")).toBe("abc");
    expect(call.raw).toBe(bytes);
  });

  it("status reads GET /mirror/status and rejects an unreadable answer", async () => {
    const { fetch: f, calls } = fakeFetch(json(STATUS));
    const { v: _v, ...expected } = STATUS;
    expect(await relayWith(f).status()).toEqual(expected);
    expect(calls[0]!.url).toBe("https://relay.example.workers.dev/mirror/status");
    expect(calls[0]!.method).toBe("GET");
    await expect(relayWith(fakeFetch(json({ ...STATUS, store: "s3" })).fetch).status()).rejects.toThrow();
  });

  it("setSettings sends PUT /mirror/settings and answers the status", async () => {
    const { fetch: f, calls } = fakeFetch(json({ ...STATUS, store: "r2" }));
    const status = await relayWith(f).setSettings({ store: "r2", limit: null });
    expect(status.store).toBe("r2");
    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.url).toBe("https://relay.example.workers.dev/mirror/settings");
    expect(calls[0]!.body).toEqual({ store: "r2", limit: null });
  });

  it("edits reads GET /mirror/edits with deleted as a boolean and drops malformed entries", async () => {
    const edits = [{ path: "a.qmd", base: "", hash: "h", deleted: 0, at: 5 }, { path: "b.qmd", base: "x", hash: "", deleted: 1, at: 6 }, { path: 3 }];
    const { fetch: f } = fakeFetch(json({ v: 1, edits }));
    expect(await relayWith(f).edits()).toEqual([
      { path: "a.qmd", base: "", hash: "h", deleted: false, at: 5 }, { path: "b.qmd", base: "x", hash: "", deleted: true, at: 6 },
    ]);
  });

  it("ackEdits posts the path and hash pairs to /mirror/edits/ack", async () => {
    const { fetch: f, calls } = fakeFetch();
    await relayWith(f).ackEdits([{ path: "a.qmd", hash: "h" }]);
    expect(calls[0]!.url).toBe("https://relay.example.workers.dev/mirror/edits/ack");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toEqual({ edits: [{ path: "a.qmd", hash: "h" }] });
  });

  it("readFile answers the bytes of GET /mirror/file/<path> with the owner secret", async () => {
    const { fetch: f, calls } = fakeFetch(() => new Response(new Uint8Array([9, 8]), { status: 200 }));
    expect(await relayWith(f).readFile("papers/a/notes.qmd")).toEqual(new Uint8Array([9, 8]));
    expect(calls[0]!.url).toBe("https://relay.example.workers.dev/mirror/file/papers/a/notes.qmd");
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer s3cret");
  });

  it.each([
    [507, { error: "full", reason: "storage" }, "full", "storage"],
    [507, { error: "full", reason: "operations" }, "full", "operations"],
    [409, { error: "conflict", hash: "h" }, "conflict", undefined],
    [409, { error: "noBucket" }, "noBucket", undefined],
    [413, { error: "tooLarge" }, "tooLarge", undefined],
  ])("a %i refusal rejects with a MirrorRefusal carrying its code and reason", async (status, body, code, reason) => {
    const { fetch: f } = fakeFetch(json(body, status));
    const error = await relayWith(f).putFile("a.png", "asset", "h", new Uint8Array()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MirrorRefusal);
    expect(error).toMatchObject({ status, code, reason });
  });
});
