/** Pins the Mirror Durable Object: rows with chunking over 2 MB, the index, the writer lease, the owner email, and migration v3. */
import { DatabaseSync } from "node:sqlite";
import { RELAY_MIGRATIONS } from "../../../src/relay/relayPaths";
import { Mirror } from "../../../src/relay/worker/mirror";
import { fakeSql } from "./fakeRoomRuntime";

const BASE = "https://mirror.test";
const MIB = 1024 * 1024;
const MINUTE = 60 * 1000;
const T0 = Date.UTC(2026, 5, 1, 12, 0, 0);

type Row = { path: string; kind: string; hash: string; size: number; value: string };
type IndexEntry = { path: string; kind: string; hash: string; size: number; updated: unknown };

const bytesOf = (text: string) => Buffer.byteLength(text, "utf8");

const rowOf = (path: string, value: string, kind = "source", hash = `hash-of-${path}-${value.length}`): Row =>
  ({ path, kind, hash, size: bytesOf(value), value });

/** A deterministic text of `length` characters with multi-byte characters mixed in, so a lossy split would show. */
function bigText(length: number, seed: string): string {
  const unit = `${seed}-é-漢字-0123456789-abcdefghijklmnopqrstuvwxyz\n`;
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}

function setup() {
  const db = new DatabaseSync(":memory:");
  const boot = () => new Mirror({
    storage: { sql: fakeSql(db), transactionSync: <T>(work: () => T): T => work() },
    blockConcurrencyWhile: async <T>(work: () => Promise<T>): Promise<T> => work(),
  } as unknown as ConstructorParameters<typeof Mirror>[0]);
  let mirror = boot();

  const send = (path: string, method: string, body?: unknown) => mirror.fetch(new Request(`${BASE}${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  }));
  const rows = (put: Row[], del: string[] = []) => send("/rows", "POST", { put, delete: del });
  const index = async (): Promise<IndexEntry[]> => {
    const response = await send("/index", "GET");
    expect(response.status).toBe(200);
    return ((await response.json()) as IndexEntry[]).sort((a, b) => a.path.localeCompare(b.path));
  };
  const file = (path: string) => send(`/file?path=${encodeURIComponent(path)}`, "GET");
  const lease = async (deviceId: string, action: "acquire" | "renew" | "release"): Promise<boolean> => {
    const response = await send("/lease", "POST", { deviceId, action });
    expect(response.status).toBe(200);
    return ((await response.json()) as { held: boolean }).held;
  };
  /** Every stored cell of every table, for checking what the object keeps and how large a single cell is. */
  const cells = (): unknown[] => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    return tables.flatMap(({ name }) => (db.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[])
      .flatMap((row) => Object.values(row)));
  };
  const cellBytes = (cell: unknown): number =>
    typeof cell === "string" ? bytesOf(cell) : cell instanceof Uint8Array ? cell.byteLength : 8;
  return {
    send, rows, index, file, lease, cells, cellBytes,
    restart: () => { mirror = boot(); },
    storedBytes: () => cells().reduce<number>((sum, cell) => sum + cellBytes(cell), 0),
    largestCell: () => Math.max(0, ...cells().map(cellBytes)),
  };
}

const at = (now: number) => jest.setSystemTime(now);

beforeEach(() => {
  // Only the clock is faked: the object's awaits and the crypto calls keep running for real.
  jest.useFakeTimers({
    now: T0,
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame",
      "requestIdleCallback", "cancelIdleCallback", "setImmediate", "clearImmediate", "setInterval", "clearInterval",
      "setTimeout", "clearTimeout"],
  });
});
afterEach(() => jest.useRealTimers());

describe("rows and the index", () => {
  it("1.2a lists a put row with its path, kind, hash, size and updated", async () => {
    const mirror = setup();
    const row = rowOf("index/papers.json", JSON.stringify({ papers: [] }), "papers", "h-papers");
    expect((await mirror.rows([row])).ok).toBe(true);
    const listed = await mirror.index();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ path: "index/papers.json", kind: "papers", hash: "h-papers", size: row.size });
    expect(listed[0]!.updated).toBeDefined();
    expect(listed[0]!.updated).not.toBeNull();
  });

  it("1.2a lists every row of one request, whatever its kind", async () => {
    const mirror = setup();
    await mirror.rows([
      rowOf("index/papers.json", "{}", "papers"),
      rowOf("papers/ml/ab12/notes.qmd", "# notes é", "notes"),
      rowOf("projects/thesis/main.tex", "\\documentclass{article}", "source"),
      rowOf("decks/talk/deck.html", "<!doctype html><title>talk</title>", "deck"),
    ]);
    const listed = await mirror.index();
    expect(listed.map((entry) => [entry.path, entry.kind])).toEqual([
      ["decks/talk/deck.html", "deck"],
      ["index/papers.json", "papers"],
      ["papers/ml/ab12/notes.qmd", "notes"],
      ["projects/thesis/main.tex", "source"],
    ]);
  });

  it("1.2a reads a row's value back from GET /file by its path", async () => {
    const mirror = setup();
    await mirror.rows([rowOf("papers/ml/ab12/notes.qmd", "# Notes\n\nCafé 漢字 ✓\n", "notes")]);
    const response = await mirror.file("papers/ml/ab12/notes.qmd");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("# Notes\n\nCafé 漢字 ✓\n");
  });

  it("1.2a replaces a row put again at the same path, keeping one entry", async () => {
    const mirror = setup();
    await mirror.rows([rowOf("projects/p/refs.bib", "@book{a}", "source", "h1")]);
    at(T0 + 5 * MINUTE);
    await mirror.rows([rowOf("projects/p/refs.bib", "@book{a}\n@book{b}", "source", "h2")]);
    const listed = await mirror.index();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ hash: "h2", size: bytesOf("@book{a}\n@book{b}") });
    expect(await (await mirror.file("projects/p/refs.bib")).text()).toBe("@book{a}\n@book{b}");
  });

  it("1.2a moves updated forward when a row is rewritten later", async () => {
    const mirror = setup();
    await mirror.rows([rowOf("projects/p/a.typ", "one", "source", "h1")]);
    const first = (await mirror.index())[0]!.updated;
    at(T0 + 3 * MINUTE);
    await mirror.rows([rowOf("projects/p/a.typ", "two", "source", "h2")]);
    expect((await mirror.index())[0]!.updated).not.toEqual(first);
  });

  it("1.2a removes the rows in the delete list and keeps the others", async () => {
    const mirror = setup();
    await mirror.rows([rowOf("projects/p/a.typ", "a"), rowOf("projects/p/b.typ", "b"), rowOf("projects/p/c.typ", "c")]);
    expect((await mirror.rows([], ["projects/p/a.typ", "projects/p/c.typ"])).ok).toBe(true);
    expect((await mirror.index()).map((entry) => entry.path)).toEqual(["projects/p/b.typ"]);
    expect((await mirror.file("projects/p/a.typ")).ok).toBe(false);
    expect(await (await mirror.file("projects/p/b.typ")).text()).toBe("b");
  });

  it("1.2a applies the puts and the deletes of one request together", async () => {
    const mirror = setup();
    await mirror.rows([rowOf("projects/p/old.typ", "old")]);
    await mirror.rows([rowOf("projects/p/new.typ", "new")], ["projects/p/old.typ"]);
    expect((await mirror.index()).map((entry) => entry.path)).toEqual(["projects/p/new.typ"]);
  });

  it("1.2a accepts a delete of a path that is not there", async () => {
    const mirror = setup();
    await mirror.rows([rowOf("projects/p/a.typ", "a")]);
    expect((await mirror.rows([], ["projects/p/missing.typ"])).ok).toBe(true);
    expect((await mirror.index()).map((entry) => entry.path)).toEqual(["projects/p/a.typ"]);
  });

  it("1.2a answers an empty list when no row was ever put", async () => {
    expect(await setup().index()).toEqual([]);
  });

  it("1.2a does not answer a file that is not there as found", async () => {
    const response = await setup().file("projects/p/nothing.typ");
    expect(response.ok).toBe(false);
  });

  it("1.2a keeps its rows across a restart of the object", async () => {
    const mirror = setup();
    await mirror.rows([rowOf("projects/p/a.typ", "kept", "source", "h-kept")]);
    mirror.restart();
    expect((await mirror.index()).map((entry) => [entry.path, entry.hash])).toEqual([["projects/p/a.typ", "h-kept"]]);
    expect(await (await mirror.file("projects/p/a.typ")).text()).toBe("kept");
  });
});

describe("a value over 2 MB", () => {
  it("1.2b returns a 5 MB value byte for byte", async () => {
    const mirror = setup();
    const value = bigText(5 * MIB, "five");
    expect((await mirror.rows([rowOf("decks/big/deck.html", value, "deck")])).ok).toBe(true);
    const response = await mirror.file("decks/big/deck.html");
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.byteLength).toBe(bytesOf(value));
    expect(Buffer.from(bytes).equals(Buffer.from(value, "utf8"))).toBe(true);
  });

  it("1.2b stores no single cell over the 2 MB SQLite row limit", async () => {
    const mirror = setup();
    await mirror.rows([rowOf("decks/big/deck.html", bigText(5 * MIB, "five"), "deck")]);
    expect(mirror.largestCell()).toBeLessThanOrEqual(2 * MIB);
    expect(mirror.storedBytes()).toBeGreaterThanOrEqual(5 * MIB);
  });

  it("1.2b lists a chunked row once, with its whole size", async () => {
    const mirror = setup();
    const value = bigText(5 * MIB, "five");
    await mirror.rows([rowOf("decks/big/deck.html", value, "deck", "h-big")]);
    const listed = await mirror.index();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ path: "decks/big/deck.html", kind: "deck", hash: "h-big", size: bytesOf(value) });
  });

  it("1.2b reads a value just over 2 MB whole", async () => {
    const mirror = setup();
    const value = bigText(2 * MIB + 17, "edge");
    await mirror.rows([rowOf("decks/edge/deck.html", value, "deck")]);
    expect(await (await mirror.file("decks/edge/deck.html")).text()).toBe(value);
  });

  it("1.2b leaves no stale chunk when a 5 MB value is replaced by a small one", async () => {
    const mirror = setup();
    await mirror.rows([rowOf("decks/big/deck.html", bigText(5 * MIB, "five"), "deck")]);
    await mirror.rows([rowOf("decks/big/deck.html", "<p>small</p>", "deck")]);
    expect(await (await mirror.file("decks/big/deck.html")).text()).toBe("<p>small</p>");
    expect(mirror.storedBytes()).toBeLessThan(64 * 1024);
  });

  it("1.2b returns the new value, with no old chunk mixed in, when a 5 MB value is replaced by a 3 MB one", async () => {
    const mirror = setup();
    await mirror.rows([rowOf("decks/big/deck.html", bigText(5 * MIB, "old"), "deck")]);
    const replacement = bigText(3 * MIB, "new");
    await mirror.rows([rowOf("decks/big/deck.html", replacement, "deck")]);
    expect(await (await mirror.file("decks/big/deck.html")).text()).toBe(replacement);
    expect(mirror.storedBytes()).toBeLessThan(bytesOf(replacement) + 64 * 1024);
  });

  it("1.2b leaves no chunk behind when the chunked row is deleted", async () => {
    const mirror = setup();
    await mirror.rows([rowOf("decks/big/deck.html", bigText(5 * MIB, "five"), "deck")]);
    await mirror.rows([], ["decks/big/deck.html"]);
    expect(await mirror.index()).toEqual([]);
    expect(mirror.storedBytes()).toBeLessThan(64 * 1024);
  });

  it("1.2b keeps two chunked rows apart", async () => {
    const mirror = setup();
    const a = bigText(4 * MIB + 5, "aaa");
    const b = bigText(3 * MIB + 9, "bbb");
    await mirror.rows([rowOf("decks/a/deck.html", a, "deck"), rowOf("decks/b/deck.html", b, "deck")]);
    expect(await (await mirror.file("decks/a/deck.html")).text()).toBe(a);
    expect(await (await mirror.file("decks/b/deck.html")).text()).toBe(b);
  });
});

describe("the writer lease", () => {
  it("1.2c grants the lease to the first device that acquires it", async () => {
    expect(await setup().lease("device-a", "acquire")).toBe(true);
  });

  it("1.2c refuses a second device while the first holds an unexpired lease", async () => {
    const mirror = setup();
    await mirror.lease("device-a", "acquire");
    at(T0 + 9 * MINUTE);
    expect(await mirror.lease("device-b", "acquire")).toBe(false);
  });

  it("1.2c accepts a second device once 10 minutes pass without a renew", async () => {
    const mirror = setup();
    await mirror.lease("device-a", "acquire");
    at(T0 + 10 * MINUTE + 1000);
    expect(await mirror.lease("device-b", "acquire")).toBe(true);
  });

  it("1.2c refuses the first device after the second took the expired lease", async () => {
    const mirror = setup();
    await mirror.lease("device-a", "acquire");
    at(T0 + 11 * MINUTE);
    await mirror.lease("device-b", "acquire");
    expect(await mirror.lease("device-a", "acquire")).toBe(false);
  });

  it("1.2c lets the holder acquire again while it holds the lease", async () => {
    const mirror = setup();
    await mirror.lease("device-a", "acquire");
    at(T0 + 2 * MINUTE);
    expect(await mirror.lease("device-a", "acquire")).toBe(true);
  });

  it("1.2c expires 10 minutes after the last acquire by the holder", async () => {
    const mirror = setup();
    await mirror.lease("device-a", "acquire");
    at(T0 + 8 * MINUTE);
    await mirror.lease("device-a", "acquire");
    at(T0 + 15 * MINUTE);
    expect(await mirror.lease("device-b", "acquire")).toBe(false);
    at(T0 + 18 * MINUTE + 1000);
    expect(await mirror.lease("device-b", "acquire")).toBe(true);
  });

  it("1.2c lets the holder renew, moving the expiry 10 minutes from the renew", async () => {
    const mirror = setup();
    await mirror.lease("device-a", "acquire");
    at(T0 + 9 * MINUTE);
    expect(await mirror.lease("device-a", "renew")).toBe(true);
    at(T0 + 15 * MINUTE);
    expect(await mirror.lease("device-b", "acquire")).toBe(false);
    at(T0 + 19 * MINUTE + 1000);
    expect(await mirror.lease("device-b", "acquire")).toBe(true);
  });

  it("1.2c refuses a renew by a device that is not the holder, and does not hand it the lease", async () => {
    const mirror = setup();
    await mirror.lease("device-a", "acquire");
    at(T0 + 2 * MINUTE);
    expect(await mirror.lease("device-b", "renew")).toBe(false);
    expect(await mirror.lease("device-b", "acquire")).toBe(false);
    expect(await mirror.lease("device-a", "renew")).toBe(true);
  });

  it("1.2c does not extend the holder's expiry on a renew by another device", async () => {
    const mirror = setup();
    await mirror.lease("device-a", "acquire");
    at(T0 + 9 * MINUTE);
    await mirror.lease("device-b", "renew");
    at(T0 + 10 * MINUTE + 1000);
    expect(await mirror.lease("device-b", "acquire")).toBe(true);
  });

  it("1.2c lets the holder release, after which another device acquires at once", async () => {
    const mirror = setup();
    await mirror.lease("device-a", "acquire");
    await mirror.lease("device-a", "release");
    at(T0 + 1000);
    expect(await mirror.lease("device-b", "acquire")).toBe(true);
  });

  it("1.2c ignores a release by a device that is not the holder", async () => {
    const mirror = setup();
    await mirror.lease("device-a", "acquire");
    await mirror.lease("device-b", "release");
    at(T0 + 1000);
    expect(await mirror.lease("device-c", "acquire")).toBe(false);
    expect(await mirror.lease("device-a", "renew")).toBe(true);
  });

  it("1.2c keeps the lease across a restart of the object", async () => {
    const mirror = setup();
    await mirror.lease("device-a", "acquire");
    mirror.restart();
    at(T0 + 2 * MINUTE);
    expect(await mirror.lease("device-b", "acquire")).toBe(false);
  });
});

describe("the owner email", () => {
  const readOwner = async (mirror: ReturnType<typeof setup>) => (await mirror.send("/owner", "GET")).text();

  it("1.2d stores the email from PUT /owner and answers it from GET /owner", async () => {
    const mirror = setup();
    expect((await mirror.send("/owner", "PUT", { email: "ada@example.org" })).ok).toBe(true);
    const response = await mirror.send("/owner", "GET");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("ada@example.org");
  });

  it("1.2d replaces the email when PUT /owner is called again", async () => {
    const mirror = setup();
    await mirror.send("/owner", "PUT", { email: "ada@example.org" });
    await mirror.send("/owner", "PUT", { email: "grace@example.org" });
    const text = await readOwner(mirror);
    expect(text).toContain("grace@example.org");
    expect(text).not.toContain("ada@example.org");
  });

  it("1.2d does not report an email before one is set", async () => {
    expect(await readOwner(setup())).not.toContain("@");
  });

  it("1.2d keeps the email across a restart of the object", async () => {
    const mirror = setup();
    await mirror.send("/owner", "PUT", { email: "ada@example.org" });
    mirror.restart();
    expect(await readOwner(mirror)).toContain("ada@example.org");
  });

  it("1.2d leaves the rows alone when the email is set", async () => {
    const mirror = setup();
    await mirror.rows([rowOf("projects/p/a.typ", "a")]);
    await mirror.send("/owner", "PUT", { email: "ada@example.org" });
    expect((await mirror.index()).map((entry) => entry.path)).toEqual(["projects/p/a.typ"]);
  });

  it("1.2d removes every row when DELETE /rows clears the library", async () => {
    const mirror = setup();
    await mirror.rows([rowOf("index/papers.json", "{}", "papers"), rowOf("projects/p/a.typ", "a"), rowOf("decks/x/deck.html", "<p>", "deck")]);
    expect((await mirror.send("/rows", "DELETE")).ok).toBe(true);
    expect(await mirror.index()).toEqual([]);
    expect((await mirror.file("projects/p/a.typ")).ok).toBe(false);
  });

  it("1.2d removes the owner email when DELETE /rows clears the library", async () => {
    const mirror = setup();
    await mirror.send("/owner", "PUT", { email: "ada@example.org" });
    await mirror.rows([rowOf("projects/p/a.typ", "a")]);
    await mirror.send("/rows", "DELETE");
    expect(await readOwner(mirror)).not.toContain("ada@example.org");
  });

  it("1.2d leaves no stored value behind after a clear, chunks included", async () => {
    const mirror = setup();
    await mirror.send("/owner", "PUT", { email: "ada@example.org" });
    await mirror.rows([rowOf("decks/big/deck.html", bigText(5 * MIB, "five"), "deck"), rowOf("projects/p/a.typ", "a")]);
    await mirror.send("/rows", "DELETE");
    expect(mirror.storedBytes()).toBeLessThan(64 * 1024);
    expect(mirror.cells().some((cell) => typeof cell === "string" && cell.includes("ada@example.org"))).toBe(false);
  });

  it("1.2d accepts rows again after a clear", async () => {
    const mirror = setup();
    await mirror.rows([rowOf("projects/p/a.typ", "a")]);
    await mirror.send("/rows", "DELETE");
    await mirror.rows([rowOf("projects/p/b.typ", "b")]);
    expect((await mirror.index()).map((entry) => entry.path)).toEqual(["projects/p/b.typ"]);
  });
});

// CONTRACT: documents/contracts/relay.md#deploy
describe("the migrations", () => {
  it("1.2e ends with v3, which creates the Mirror class as a SQLite class", () => {
    expect(RELAY_MIGRATIONS.at(-1)).toEqual({ tag: "v3", new_sqlite_classes: ["Mirror"] });
  });

  it("1.2e keeps v1 and v2 unchanged before v3", () => {
    expect(RELAY_MIGRATIONS).toEqual([
      { tag: "v1", new_sqlite_classes: ["Room"] },
      { tag: "v2", new_sqlite_classes: ["Inbox"] },
      { tag: "v3", new_sqlite_classes: ["Mirror"] },
    ]);
  });
});
