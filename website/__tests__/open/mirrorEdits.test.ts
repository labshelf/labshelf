// Pins how /open/ sends edits: the client's PUT/DELETE /mirror/edit with the last seen hash as base, and the file system's skip, coalescing and conflict.
import { createMirrorFileSystem, CONFLICT_NOTICE } from "../../src/open/mirrorFileSystem";
import { openRemoteLibrary, type EditAnswer, type RemoteLibraryClient } from "../../src/open/remoteClient";

const RELAY = "https://labshelf-relay-abc123.owner.workers.dev";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Seen { method: string; path: string; base: string | null; body: string }

async function readyClient(answer: (seen: Seen) => Response) {
  const seen: Seen[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname === "/api/directory/self") { return json({ relayUrl: RELAY }); }
    if (url.pathname === "/mirror/session") { return json({ session: "s" }); }
    if (url.pathname === "/mirror/index") { return json({ v: 3, rows: [{ path: "spaces/a/space.json", kind: "space", hash: "h0", size: 2, updated: 1 }] }); }
    const call = { method: init?.method ?? "GET", path: decodeURIComponent(url.pathname), base: new Headers(init?.headers).get("x-labshelf-base"), body: String(init?.body ?? "") };
    seen.push(call);
    return answer(call);
  }) as typeof globalThis.fetch;
  const state = await openRemoteLibrary("token", { fetch });
  if (state.kind !== "ready") { throw new Error(state.kind); }
  return { client: state.client, seen };
}

describe("the client's edits", () => {
  it("G sends PUT /mirror/edit/<path> with the base header and keeps the new hash", async () => {
    const { client, seen } = await readyClient(() => json({ v: 3, hash: "h1" }));
    await client.index();
    expect(client.hashOf("spaces/a/space.json")).toBe("h0");
    await expect(client.write("spaces/a/space.json", "{}", client.hashOf("spaces/a/space.json"))).resolves.toEqual({ ok: true, hash: "h1" });
    expect(seen[0]).toEqual({ method: "PUT", path: "/mirror/edit/spaces/a/space.json", base: "h0", body: "{}" });
    expect(client.hashOf("spaces/a/space.json")).toBe("h1");
  });

  it("G answers a conflict and keeps the hash it had", async () => {
    const { client } = await readyClient(() => json({ v: 3, error: "conflict", hash: "other" }, 409));
    await client.index();
    await expect(client.write("spaces/a/space.json", "{}", "h0")).resolves.toEqual({ ok: false, conflict: true, hash: "other" });
    expect(client.hashOf("spaces/a/space.json")).toBe("h0");
  });

  it("G removes with DELETE and an empty hash after", async () => {
    const { client, seen } = await readyClient(() => json({ v: 3 }));
    await client.index();
    await client.remove("spaces/a/space.json", "h0");
    expect(seen[0]?.method).toBe("DELETE");
    expect(client.hashOf("spaces/a/space.json")).toBe("");
  });

  it("G throws the full refusal", async () => {
    const { client } = await readyClient(() => json({ v: 3, error: "full", reason: "storage" }, 507));
    await expect(client.write("x.qmd", "a", "")).rejects.toThrow(/full/);
  });
});

function fakeClient(answers: EditAnswer[] = []) {
  const hashes = new Map([["spaces/a/space.json", "h0"]]);
  const writes: { path: string; data: string | Uint8Array; base: string }[] = [];
  let n = 0;
  const client: Pick<RemoteLibraryClient, "file" | "bytes" | "hashOf" | "write" | "remove"> = {
    file: async () => "{\"seen\":1}",
    bytes: async () => new Uint8Array([1, 2]),
    hashOf: (path) => hashes.get(path) ?? "",
    write: async (path, data, base) => {
      writes.push({ path, data, base });
      const answer = answers.shift() ?? { ok: true, hash: `h${++n}` };
      if (answer.ok) { hashes.set(path, answer.hash); }
      return answer;
    },
    remove: async () => ({ ok: true, hash: "" }),
  };
  return { client, writes };
}

const ROWS = [{ path: "spaces/a/space.json", kind: "space", size: 10, updated: 1 }, { path: "projects/p/fig.png", kind: "asset", size: 2, updated: 1 }];

describe("the Mirror file system", () => {
  it("G sends nothing when the text written is the text held (markSeen on view)", async () => {
    const { client, writes } = fakeClient();
    const fs = await createMirrorFileSystem(ROWS, client, 5);
    await fs.writeText("spaces/a/space.json", "{\"seen\":1}");
    await fs.flush();
    expect(writes).toEqual([]);
  });

  it("G coalesces rapid writes of one path into one edit, the last winning, with the last acked hash as base", async () => {
    const { client, writes } = fakeClient();
    const fs = await createMirrorFileSystem(ROWS, client, 5);
    const all = Promise.all([fs.writeText("spaces/a/space.json", "1"), fs.writeText("spaces/a/space.json", "2"), fs.writeText("spaces/a/space.json", "3")]);
    expect(await fs.readText("spaces/a/space.json")).toBe("3");
    await all;
    expect(writes).toEqual([{ path: "spaces/a/space.json", data: "3", base: "h0" }]);
    await fs.writeText("spaces/a/space.json", "4");
    expect(writes[1]).toEqual({ path: "spaces/a/space.json", data: "4", base: "h1" });
  });

  it("G rejects a conflict with the notice and keeps the page's text", async () => {
    const { client } = fakeClient([{ ok: false, conflict: true, hash: "x" }]);
    const fs = await createMirrorFileSystem(ROWS, client, 5);
    await expect(fs.writeText("spaces/a/space.json", "mine")).rejects.toThrow(CONFLICT_NOTICE);
    expect(await fs.readText("spaces/a/space.json")).toBe("mine");
  });

  it("G reads a binary row as bytes on first read and makes local folders", async () => {
    const { client } = fakeClient();
    const fs = await createMirrorFileSystem(ROWS, client, 5);
    expect(Array.from(await fs.readFile("projects/p/fig.png"))).toEqual([1, 2]);
    await fs.ensureDir("spaces/a/notes");
    expect(await fs.exists("spaces/a/notes")).toBe(true);
    await expect(fs.trash("spaces/a")).rejects.toThrow(/not available/);
  });
});
