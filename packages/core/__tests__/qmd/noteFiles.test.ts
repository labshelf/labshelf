/**
 * Tests the note files port (plan charts, spec 3.3, D4/D5): safeNotePath, the client that turns port calls into request/reply
 * messages, and the guards for the identity-free request and reply.
 */
import { createNoteFilesClient, isNoteFileReply, isNoteFileRequest, safeNotePath } from "../../src/qmd/noteFiles";

const b64 = (text: string): string => Buffer.from(text, "utf8").toString("base64");

interface Rig {
  posted: Record<string, unknown>[];
  reply(message: unknown): void;
  port: ReturnType<typeof createNoteFilesClient>;
}

function rig(): Rig {
  const posted: Record<string, unknown>[] = [];
  let listener: ((message: unknown) => void) | null = null;
  const port = createNoteFilesClient(
    (message) => { posted.push(message as Record<string, unknown>); },
    (next) => { listener = next; return () => { listener = null; }; },
  );
  return { posted, port, reply: (message) => { listener?.(message); } };
}

/** Runs a port call that may reject, throw or resolve; never waits for a reply that will not come. */
async function attempt(call: () => Promise<unknown>): Promise<void> {
  await Promise.race([(async () => call())().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 20))]);
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("safeNotePath", () => {
  it("3.3a accepts assets/ab12cd34.csv and returns it unchanged", () => {
    expect(safeNotePath("assets/ab12cd34.csv")).toBe("assets/ab12cd34.csv");
  });

  it.each(["../x.csv", "/x.csv", "C:/x.csv", "assets/../x.csv"])("3.3a refuses %s", (path) => {
    expect(safeNotePath(path)).toBeNull();
  });

  it.each(["", "x.csv", "notes/x.csv", "assets//x.csv", "assets/a/../../x.csv", "assets/./x.csv", "c:/assets/x.csv", "assets/.."])(
    "3.3a refuses %j (not under assets/, empty segment, dot segment or drive letter)",
    (path) => {
      expect(safeNotePath(path)).toBeNull();
    },
  );
});

describe("createNoteFilesClient", () => {
  it("3.3b read posts one noteFile.read request with a requestId and the path", async () => {
    const { posted, port } = rig();
    void port.read("assets/ab12cd34.csv");
    await tick();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({ type: "noteFile.read", requestId: expect.any(String), path: "assets/ab12cd34.csv" });
    expect((posted[0]!["requestId"] as string).length).toBeGreaterThan(0);
  });

  it("3.3b read resolves with the bytes of the reply that has its requestId", async () => {
    const { posted, port, reply } = rig();
    const pending = port.read("assets/ab12cd34.csv");
    await tick();
    reply({ type: "noteFile.reply", requestId: posted[0]!["requestId"], base64: b64("t,v\n1,2\n") });
    const bytes = await pending;
    expect(bytes).not.toBeNull();
    expect(Buffer.from(bytes!).toString("utf8")).toBe("t,v\n1,2\n");
  });

  it("3.3b read resolves null when the reply carries base64 null (missing file)", async () => {
    const { posted, port, reply } = rig();
    const pending = port.read("assets/ab12cd34.csv");
    await tick();
    reply({ type: "noteFile.reply", requestId: posted[0]!["requestId"], base64: null });
    await expect(pending).resolves.toBeNull();
  });

  it("3.3b write posts one noteFile.write request carrying the bytes as base64", async () => {
    const { posted, port, reply } = rig();
    const pending = port.write("assets/ab12cd34.csv", new Uint8Array(Buffer.from("t,v\n1,2\n", "utf8")));
    await tick();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({ type: "noteFile.write", requestId: expect.any(String), path: "assets/ab12cd34.csv", base64: b64("t,v\n1,2\n") });
    reply({ type: "noteFile.reply", requestId: posted[0]!["requestId"] });
    await expect(pending).resolves.toBeUndefined();
  });

  it("3.3b pick posts one noteFile.pick request with the accept list", async () => {
    const { posted, port } = rig();
    void port.pickTextFile([".csv", ".tsv"]);
    await tick();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({ type: "noteFile.pick", requestId: expect.any(String), accept: [".csv", ".tsv"] });
  });

  it("3.3b pick resolves with the name and text of the picked file", async () => {
    const { posted, port, reply } = rig();
    const pending = port.pickTextFile([".csv"]);
    await tick();
    reply({ type: "noteFile.reply", requestId: posted[0]!["requestId"], file: { name: "data.csv", text: "a,b\n1,2\n" } });
    await expect(pending).resolves.toEqual({ name: "data.csv", text: "a,b\n1,2\n" });
  });

  it("3.3b pick resolves null when the reply carries file null (cancelled)", async () => {
    const { posted, port, reply } = rig();
    const pending = port.pickTextFile([".csv"]);
    await tick();
    reply({ type: "noteFile.reply", requestId: posted[0]!["requestId"], file: null });
    await expect(pending).resolves.toBeNull();
  });

  it("3.3b a reply with an error rejects with Error(error)", async () => {
    const { posted, port, reply } = rig();
    const pending = port.write("assets/ab12cd34.csv", new Uint8Array([1]));
    await tick();
    reply({ type: "noteFile.reply", requestId: posted[0]!["requestId"], error: "disk full" });
    await expect(pending).rejects.toThrow("disk full");
  });

  it("3.3b two requests in flight get distinct requestIds and each resolves on its own reply, in any order", async () => {
    const { posted, port, reply } = rig();
    const first = port.read("assets/aaaaaaaa.csv");
    const second = port.read("assets/bbbbbbbb.csv");
    await tick();
    expect(posted).toHaveLength(2);
    expect(posted[0]!["requestId"]).not.toBe(posted[1]!["requestId"]);
    reply({ type: "noteFile.reply", requestId: posted[1]!["requestId"], base64: b64("second") });
    reply({ type: "noteFile.reply", requestId: posted[0]!["requestId"], base64: b64("first") });
    expect(Buffer.from((await first)!).toString("utf8")).toBe("first");
    expect(Buffer.from((await second)!).toString("utf8")).toBe("second");
  });

  it("3.3b a reply with an unknown requestId is ignored", async () => {
    const { posted, port, reply } = rig();
    let settled = false;
    const pending = port.read("assets/ab12cd34.csv").then((value) => { settled = true; return value; });
    await tick();
    reply({ type: "noteFile.reply", requestId: "no-such-request", base64: b64("x") });
    await tick();
    expect(settled).toBe(false);
    reply({ type: "noteFile.reply", requestId: posted[0]!["requestId"], base64: b64("ok") });
    expect(Buffer.from((await pending)!).toString("utf8")).toBe("ok");
  });

  it("3.3b a message that is not a reply is ignored", async () => {
    const { posted, port, reply } = rig();
    let settled = false;
    const pending = port.read("assets/ab12cd34.csv").then((value) => { settled = true; return value; });
    await tick();
    reply({ type: "somethingElse", requestId: posted[0]!["requestId"], base64: b64("x") });
    reply("noise");
    reply(null);
    await tick();
    expect(settled).toBe(false);
    reply({ type: "noteFile.reply", requestId: posted[0]!["requestId"], base64: null });
    await expect(pending).resolves.toBeNull();
  });

  it.each(["../x.csv", "/x.csv", "C:/x.csv", "assets/../x.csv"])("3.3a read of %s posts no message", async (path) => {
    const { posted, port } = rig();
    await attempt(() => port.read(path));
    await tick();
    expect(posted).toHaveLength(0);
  });

  it.each(["../x.csv", "/x.csv", "C:/x.csv", "assets/../x.csv"])("3.3a write of %s posts no message", async (path) => {
    const { posted, port } = rig();
    await attempt(() => port.write(path, new Uint8Array([1])));
    await tick();
    expect(posted).toHaveLength(0);
  });
});

describe("isNoteFileRequest", () => {
  it("3.3b accepts read, write and pick requests", () => {
    expect(isNoteFileRequest({ type: "noteFile.read", requestId: "r1", path: "assets/ab12cd34.csv" })).toBe(true);
    expect(isNoteFileRequest({ type: "noteFile.write", requestId: "r2", path: "assets/ab12cd34.csv", base64: "YQ==" })).toBe(true);
    expect(isNoteFileRequest({ type: "noteFile.pick", requestId: "r3", accept: [".csv"] })).toBe(true);
  });

  it.each(["../x.csv", "/x.csv", "C:/x.csv", "assets/../x.csv"])("3.3b rejects a read or write whose path safeNotePath refuses: %s", (path) => {
    expect(isNoteFileRequest({ type: "noteFile.read", requestId: "r1", path })).toBe(false);
    expect(isNoteFileRequest({ type: "noteFile.write", requestId: "r1", path, base64: "YQ==" })).toBe(false);
  });

  it.each([
    [null],
    ["noteFile.read"],
    [{}],
    [{ type: "noteFile.delete", requestId: "r1", path: "assets/a.csv" }],
    [{ type: "noteFile.read", path: "assets/a.csv" }],
    [{ type: "noteFile.read", requestId: 7, path: "assets/a.csv" }],
    [{ type: "noteFile.read", requestId: "r1" }],
    [{ type: "noteFile.write", requestId: "r1", path: "assets/a.csv" }],
    [{ type: "noteFile.write", requestId: "r1", path: "assets/a.csv", base64: 5 }],
    [{ type: "noteFile.pick", requestId: "r1" }],
    [{ type: "noteFile.pick", requestId: "r1", accept: ".csv" }],
    [{ type: "noteFile.pick", requestId: "r1", accept: [1] }],
  ])("3.3b rejects the malformed request %j", (raw) => {
    expect(isNoteFileRequest(raw)).toBe(false);
  });
});

describe("isNoteFileReply", () => {
  it("3.3b accepts a reply with bytes, with null bytes, with a file, with null file, with an error and with none", () => {
    expect(isNoteFileReply({ type: "noteFile.reply", requestId: "r1", base64: "YQ==" })).toBe(true);
    expect(isNoteFileReply({ type: "noteFile.reply", requestId: "r1", base64: null })).toBe(true);
    expect(isNoteFileReply({ type: "noteFile.reply", requestId: "r1", file: { name: "a.csv", text: "x" } })).toBe(true);
    expect(isNoteFileReply({ type: "noteFile.reply", requestId: "r1", file: null })).toBe(true);
    expect(isNoteFileReply({ type: "noteFile.reply", requestId: "r1", error: "nope" })).toBe(true);
    expect(isNoteFileReply({ type: "noteFile.reply", requestId: "r1" })).toBe(true);
  });

  it.each([
    [null],
    ["x"],
    [{ type: "noteFile.reply" }],
    [{ requestId: "r1" }],
    [{ type: "noteFile.read", requestId: "r1" }],
    [{ type: "noteFile.reply", requestId: 1 }],
    [{ type: "noteFile.reply", requestId: "r1", base64: 5 }],
    [{ type: "noteFile.reply", requestId: "r1", error: 5 }],
    [{ type: "noteFile.reply", requestId: "r1", file: { name: "a.csv" } }],
  ])("3.3b rejects the malformed reply %j", (raw) => {
    expect(isNoteFileReply(raw)).toBe(false);
  });
});
