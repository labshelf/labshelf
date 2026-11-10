/** Pins the Mirror's storage: binary files, the settings and limits, the R2 store and its monthly operations, and the edits made on /open/. */
import { DatabaseSync } from "node:sqlite";
import { deriveSha256Hex } from "../../../src/hash";
import { Mirror } from "../../../src/relay/worker/mirror";
import { fakeMirrorState } from "./fakeRoomRuntime";
import { BASE, T0, rowOf, setup, at, useFakeClock } from "./mirrorFixtures";

useFakeClock();

type Status = {
  generation: string; store: string; used: number; limit: number; includePdfs: boolean; rows: number; edits: number;
  r2: { bound: boolean; month: string; operations: number };
};

const statusOf = async (mirror: ReturnType<typeof setup>): Promise<Status> => (await (await mirror.send("/status", "GET")).json()) as Status;
const settings = (mirror: ReturnType<typeof setup>, body: unknown) => mirror.send("/settings", "PUT", body);
const putFile = (mirror: ReturnType<typeof setup>, path: string, bytes: Uint8Array, kind = "asset") =>
  mirror.raw(`/file?path=${encodeURIComponent(path)}`, {
    method: "PUT", headers: { "x-labshelf-kind": kind, "x-labshelf-hash": `h-${path}` }, body: bytes as Uint8Array<ArrayBuffer>,
  });
const edit = (mirror: ReturnType<typeof setup>, path: string, base: string, text?: string) =>
  mirror.raw(`/edit?path=${encodeURIComponent(path)}`, {
    method: text === undefined ? "DELETE" : "PUT", headers: { "x-labshelf-base": base }, ...(text === undefined ? {} : { body: text }),
  });
const editsOf = async (mirror: ReturnType<typeof setup>) =>
  ((await (await mirror.send("/edits", "GET")).json()) as { edits: { path: string; base: string; hash: string; deleted: boolean }[] }).edits;
const allBytes = (length: number) => Uint8Array.from({ length }, (_, index) => index % 256);
const sha = (text: string) => deriveSha256Hex(new TextEncoder().encode(text));

describe("status and settings", () => {
  it("B starts in store do with the 5 GB limit, paper PDFs off and a base64url generation", async () => {
    const status = await statusOf(setup());
    expect(status).toEqual({
      generation: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), store: "do", used: 0, limit: 5_000_000_000, includePdfs: false, rows: 0, edits: 0,
      r2: { bound: true, month: "2026-06", operations: 0 },
    });
  });

  it("B counts used bytes and rows", async () => {
    const mirror = setup();
    await mirror.rows([rowOf("a.qmd", "12345"), rowOf("b.qmd", "678")]);
    expect(await statusOf(mirror)).toMatchObject({ used: 8, rows: 2 });
  });

  it("B keeps the generation across a restart", async () => {
    const mirror = setup();
    const { generation } = await statusOf(mirror);
    mirror.restart();
    expect((await statusOf(mirror)).generation).toBe(generation);
  });

  it("C sets a limit and paper PDFs and answers the status", async () => {
    const mirror = setup();
    const response = await settings(mirror, { limit: 1000, includePdfs: true });
    expect(await response.json()).toMatchObject({ limit: 1000, includePdfs: true, store: "do" });
    expect(await statusOf(mirror)).toMatchObject({ limit: 1000, includePdfs: true });
  });

  it("C resets the limit to the store's default with null", async () => {
    const mirror = setup();
    await settings(mirror, { limit: 1000 });
    await settings(mirror, { limit: null });
    expect((await statusOf(mirror)).limit).toBe(5_000_000_000);
  });

  it("C refuses a do limit over 5 GB as malformed", async () => {
    const mirror = setup();
    const response = await settings(mirror, { limit: 5_000_000_001 });
    expect(await response.json()).toMatchObject({ error: "malformed" });
    expect((await statusOf(mirror)).limit).toBe(5_000_000_000);
  });

  it("C refuses a malformed settings body", async () => {
    const mirror = setup();
    expect(await (await settings(mirror, { store: "s3" })).json()).toMatchObject({ error: "malformed" });
    expect(await (await settings(mirror, { includePdfs: "yes" })).json()).toMatchObject({ error: "malformed" });
  });

  it("C refuses store r2 without the bucket binding as noBucket", async () => {
    const mirror = setup();
    delete mirror.env.MIRROR_BUCKET;
    mirror.restart();
    const response = await settings(mirror, { store: "r2" });
    expect(await response.json()).toMatchObject({ error: "noBucket" });
    expect(await statusOf(mirror)).toMatchObject({ store: "do", r2: { bound: false } });
  });

  it("C moving the store clears rows, chunks and edits, draws a new generation and keeps the owner", async () => {
    const mirror = setup();
    await mirror.send("/owner", "PUT", { email: "o@x.org" });
    await mirror.rows([rowOf("projects/p/main.tex", "text")]);
    await edit(mirror, "spaces/s/space.json", "", "{}");
    const before = await statusOf(mirror);
    const after = (await (await settings(mirror, { store: "r2" })).json()) as Status;
    expect(after).toMatchObject({ store: "r2", rows: 0, edits: 0, used: 0, limit: 9_000_000_000 });
    expect(after.generation).not.toBe(before.generation);
    expect(mirror.db.prepare("SELECT COUNT(*) AS n FROM chunks").get()).toEqual({ n: 0 });
    expect(await (await mirror.send("/owner", "GET")).json()).toEqual({ email: "o@x.org" });
  });
});

describe("binary files", () => {
  it("B stores and returns every byte value from PUT /file", async () => {
    const mirror = setup();
    const bytes = allBytes(1000);
    expect((await putFile(mirror, "projects/p/fig.png", bytes)).status).toBe(200);
    expect(new Uint8Array(await (await mirror.file("projects/p/fig.png")).arrayBuffer())).toEqual(bytes);
    expect((await index(mirror))[0]).toMatchObject({ path: "projects/p/fig.png", kind: "asset", hash: "h-projects/p/fig.png", size: 1000 });
  });

  it("B refuses a file without a kind or with an unknown kind", async () => {
    const mirror = setup();
    expect(await (await putFile(mirror, "x.bin", allBytes(3), "movie")).json()).toMatchObject({ error: "malformed" });
    expect(await (await mirror.raw("/file?path=x.bin", { method: "PUT", body: "x" })).json()).toMatchObject({ error: "malformed" });
  });

  it("B refuses a path that climbs out of the library", async () => {
    const mirror = setup();
    expect(await (await putFile(mirror, "../etc/passwd", allBytes(3))).json()).toMatchObject({ error: "malformed" });
  });
});

const index = async (mirror: ReturnType<typeof setup>) => mirror.index();

describe("limits", () => {
  it("B refuses a put past the limit as full with reason storage and writes nothing", async () => {
    const mirror = setup();
    await settings(mirror, { limit: 10 });
    await mirror.rows([rowOf("a.qmd", "123456")]);
    const response = await mirror.rows([rowOf("b.qmd", "12345")]);
    expect(await response.json()).toEqual({ error: "full", reason: "storage" });
    expect((await index(mirror)).map((entry) => entry.path)).toEqual(["a.qmd"]);
  });

  it("B counts a replaced row's old size out", async () => {
    const mirror = setup();
    await settings(mirror, { limit: 10 });
    await mirror.rows([rowOf("a.qmd", "123456")]);
    expect((await mirror.rows([rowOf("a.qmd", "1234567890")])).status).toBe(200);
  });

  it("B answers a SQLite write that throws as full with reason storage and keeps the old row", async () => {
    const db = new DatabaseSync(":memory:");
    const state = fakeMirrorState(db);
    let refuse = false;
    const sql = state.storage.sql;
    state.storage.sql = {
      exec: (query, ...bindings) => {
        if (refuse && query.startsWith("INSERT INTO chunks")) { throw new Error("SQLITE_FULL: database or disk is full"); }
        return sql.exec(query, ...bindings);
      },
    } as typeof sql;
    const mirror = new Mirror(state, {});
    const put = (value: string) => mirror.fetch(new Request(`${BASE}/rows`, { method: "POST", body: JSON.stringify({ put: [rowOf("a.qmd", value)] }) }));
    await put("old");
    refuse = true;
    expect(await (await put("new value")).json()).toEqual({ error: "full", reason: "storage" });
    refuse = false;
    expect(await (await mirror.fetch(new Request(`${BASE}/file?path=a.qmd`))).text()).toBe("old");
  });
});

describe("store r2", () => {
  async function r2Mirror() {
    const mirror = setup();
    await settings(mirror, { store: "r2" });
    return { mirror, generation: (await statusOf(mirror)).generation };
  }

  it("B keeps one R2 object per row at <generation>/<path> and no chunk", async () => {
    const { mirror, generation } = await r2Mirror();
    await mirror.rows([rowOf("papers/a/notes.qmd", "hello")]);
    await putFile(mirror, "papers/a/paper.pdf", allBytes(300), "pdf");
    expect([...mirror.bucket.objects.keys()].sort()).toEqual([`${generation}/papers/a/notes.qmd`, `${generation}/papers/a/paper.pdf`]);
    expect(mirror.db.prepare("SELECT COUNT(*) AS n FROM chunks").get()).toEqual({ n: 0 });
    expect(await (await mirror.file("papers/a/notes.qmd")).text()).toBe("hello");
    expect(new Uint8Array(await (await mirror.file("papers/a/paper.pdf")).arrayBuffer())).toEqual(allBytes(300));
  });

  it("B counts each put as one operation of the UTC month", async () => {
    const { mirror } = await r2Mirror();
    await mirror.rows([rowOf("a.qmd", "1"), rowOf("b.qmd", "2")]);
    expect((await statusOf(mirror)).r2).toEqual({ bound: true, month: "2026-06", operations: 2 });
  });

  it("B refuses puts with reason operations at 900,000 operations, and resets in the next month", async () => {
    const { mirror } = await r2Mirror();
    mirror.db.exec("UPDATE settings SET ops_month = '2026-06', ops_count = 900000");
    expect(await (await mirror.rows([rowOf("a.qmd", "1")])).json()).toEqual({ error: "full", reason: "operations" });
    expect(mirror.bucket.objects.size).toBe(0);
    at(Date.UTC(2026, 6, 1, 0, 0, 1));
    expect((await statusOf(mirror)).r2).toMatchObject({ month: "2026-07", operations: 0 });
    expect((await mirror.rows([rowOf("a.qmd", "1")])).status).toBe(200);
    expect((await statusOf(mirror)).r2.operations).toBe(1);
  });

  it("B deletes a row's object with the row", async () => {
    const { mirror } = await r2Mirror();
    await mirror.rows([rowOf("a.qmd", "1"), rowOf("b.qmd", "2")]);
    await mirror.rows([], ["a.qmd"]);
    expect([...mirror.bucket.objects.keys()].map((key) => key.split("/")[1])).toEqual(["b.qmd"]);
  });

  it("C DELETE /rows removes every object of the generation and draws a new one", async () => {
    const { mirror, generation } = await r2Mirror();
    await mirror.rows(Array.from({ length: 5 }, (_, n) => rowOf(`n${n}.qmd`, "x")));
    mirror.bucket.objects.set("other/kept", new Uint8Array(1));
    expect((await mirror.send("/rows", "DELETE")).status).toBe(200);
    expect([...mirror.bucket.objects.keys()]).toEqual(["other/kept"]);
    expect((await statusOf(mirror)).generation).not.toBe(generation);
  });

  it("C moving back to do clears the R2 objects", async () => {
    const { mirror } = await r2Mirror();
    await mirror.rows([rowOf("a.qmd", "1")]);
    await settings(mirror, { store: "do" });
    expect(mirror.bucket.objects.size).toBe(0);
    expect(await statusOf(mirror)).toMatchObject({ store: "do", rows: 0 });
  });

  it("B refuses a put as noBucket when the binding went away", async () => {
    const { mirror } = await r2Mirror();
    delete mirror.env.MIRROR_BUCKET;
    mirror.restart();
    expect(await (await mirror.rows([rowOf("a.qmd", "1")])).json()).toEqual({ error: "noBucket" });
  });
});

describe("edits from /open/", () => {
  it("C writes a new file with base \"\", derives its kind from the path and answers its SHA-256", async () => {
    const mirror = setup();
    const response = await edit(mirror, "spaces/s/notes/n.qmd", "", "body");
    expect(await response.json()).toEqual({ hash: await sha("body") });
    expect((await index(mirror))[0]).toMatchObject({ path: "spaces/s/notes/n.qmd", kind: "space", hash: await sha("body"), size: 4 });
    expect(await (await mirror.file("spaces/s/notes/n.qmd")).text()).toBe("body");
  });

  it("C derives home, notes and source kinds, and keeps an existing row's kind", async () => {
    const mirror = setup();
    await mirror.rows([rowOf("projects/p/deck.html", "d", "deck", "hd")]);
    await edit(mirror, "home.json", "", "{}");
    await edit(mirror, "papers/a/notes.qmd", "", "n");
    await edit(mirror, "projects/p/main.tex", "", "t");
    await edit(mirror, "projects/p/deck.html", "hd", "d2");
    expect(Object.fromEntries((await index(mirror)).map((entry) => [entry.path, entry.kind]))).toEqual({
      "home.json": "home", "papers/a/notes.qmd": "notes", "projects/p/main.tex": "source", "projects/p/deck.html": "deck",
    });
  });

  it("C gives a new file outside home, spaces and papers the kind source", async () => {
    const mirror = setup();
    await edit(mirror, "other/x.txt", "", "x");
    expect((await index(mirror))[0]).toMatchObject({ path: "other/x.txt", kind: "source" });
  });

  it("C answers conflict with the current hash when the base is stale, and writes nothing", async () => {
    const mirror = setup();
    await mirror.rows([rowOf("papers/a/notes.qmd", "v1", "notes", "h1")]);
    const response = await edit(mirror, "papers/a/notes.qmd", "h0", "mine");
    expect(await response.json()).toEqual({ error: "conflict", hash: "h1" });
    expect(await (await mirror.file("papers/a/notes.qmd")).text()).toBe("v1");
    expect(await editsOf(mirror)).toEqual([]);
  });

  it("C answers conflict with hash \"\" for a base given on a missing row", async () => {
    expect(await (await edit(setup(), "papers/a/notes.qmd", "h1", "x")).json()).toEqual({ error: "conflict", hash: "" });
  });

  it("C keeps the earliest base and the latest hash of unacked edits", async () => {
    const mirror = setup();
    await mirror.rows([rowOf("papers/a/notes.qmd", "v1", "notes", "h1")]);
    const first = ((await (await edit(mirror, "papers/a/notes.qmd", "h1", "v2")).json()) as { hash: string }).hash;
    await edit(mirror, "papers/a/notes.qmd", first, "v3");
    expect(await editsOf(mirror)).toEqual([
      { path: "papers/a/notes.qmd", base: "h1", hash: await sha("v3"), deleted: false, at: T0 },
    ]);
  });

  it("C records a delete with deleted and hash \"\", and removes the row", async () => {
    const mirror = setup();
    await mirror.rows([rowOf("spaces/s/space.json", "{}", "space", "hs")]);
    expect(await (await edit(mirror, "spaces/s/space.json", "hs")).json()).toEqual({});
    expect(await index(mirror)).toEqual([]);
    expect(await editsOf(mirror)).toEqual([{ path: "spaces/s/space.json", base: "hs", hash: "", deleted: true, at: T0 }]);
  });

  it("C refuses a delete with a stale base as conflict", async () => {
    const mirror = setup();
    await mirror.rows([rowOf("spaces/s/space.json", "{}", "space", "hs")]);
    expect(await (await edit(mirror, "spaces/s/space.json", "old")).json()).toEqual({ error: "conflict", hash: "hs" });
    expect(await index(mirror)).toHaveLength(1);
  });

  it("C acks an edit only while its hash still matches", async () => {
    const mirror = setup();
    await edit(mirror, "home.json", "", "a");
    await edit(mirror, "spaces/s/space.json", "", "b");
    await mirror.send("/edits/ack", "POST", { edits: [{ path: "home.json", hash: await sha("a") }, { path: "spaces/s/space.json", hash: "stale" }] });
    expect((await editsOf(mirror)).map((entry) => entry.path)).toEqual(["spaces/s/space.json"]);
  });

  it("C refuses an edit without x-labshelf-base", async () => {
    const response = await setup().raw("/edit?path=home.json", { method: "PUT", body: "x" });
    expect(await response.json()).toMatchObject({ error: "malformed" });
  });

  it("C DELETE /rows clears the edits", async () => {
    const mirror = setup();
    await edit(mirror, "home.json", "", "a");
    await mirror.send("/rows", "DELETE");
    expect(await editsOf(mirror)).toEqual([]);
  });
});
