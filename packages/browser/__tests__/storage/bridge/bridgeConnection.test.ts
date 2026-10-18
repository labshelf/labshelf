// Pins the bridge connection: request ids, chunked file transfer and error mapping.
import { BRIDGE_CHUNK_BYTES, BridgeError } from "@labshelf/core";
import { BridgeClosedError, BridgeConnection } from "../../../src/storage/bridge";
import { FakeBridgeHost, silentLogger } from "./fakeBridgeHost";

function bytesOf(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => index % 251);
}

function setup() {
  const host = new FakeBridgeHost();
  const changed: string[][] = [];
  const connection = new BridgeConnection(host, silentLogger, (paths) => changed.push(paths));
  return { host, connection, changed };
}

describe("BridgeConnection", () => {
  it("assembles a file the host streams in several chunks", async () => {
    const { host, connection } = setup();
    const bytes = bytesOf(BRIDGE_CHUNK_BYTES * 2 + 10);
    host.files.set("papers/a/paper.pdf", bytes);

    await expect(connection.readFile("papers/a/paper.pdf")).resolves.toEqual(bytes);
  });

  it("sends a write as writeFile, chunks and a commit with the total size, all under one id", async () => {
    const { host, connection } = setup();
    const bytes = bytesOf(BRIDGE_CHUNK_BYTES + 5);

    await connection.writeFile("papers/a/paper.pdf", bytes);

    const ops = host.posted.map((m) => m.op);
    expect(ops).toEqual(["writeFile", "chunk", "chunk", "commit"]);
    expect(new Set(host.posted.map((m) => m.id)).size).toBe(1);
    expect(host.ofOp("commit")[0]!.size).toBe(bytes.length);
    expect(host.files.get("papers/a/paper.pdf")).toEqual(bytes);
  });

  it("commits an empty file without chunks", async () => {
    const { host, connection } = setup();
    await connection.writeFile("empty.txt", new Uint8Array());
    expect(host.posted.map((m) => m.op)).toEqual(["writeFile", "commit"]);
    expect(host.files.get("empty.txt")).toEqual(new Uint8Array());
  });

  it("rejects with the host's error code", async () => {
    const { connection } = setup();
    const failure = connection.readFile("missing.txt");
    await expect(failure).rejects.toBeInstanceOf(BridgeError);
    await expect(failure).rejects.toMatchObject({ code: "notFound" });
  });

  it("fails every pending request when the port closes, and refuses later ones", async () => {
    const { host, connection } = setup();
    host.mute.add("stat");
    const pending = connection.request({ op: "stat", path: "a" });

    host.close("Native host has exited.");

    await expect(pending).rejects.toBeInstanceOf(BridgeClosedError);
    await expect(pending).rejects.toMatchObject({ reason: "Native host has exited." });
    expect(connection.isOpen).toBe(false);
    await expect(connection.request({ op: "stat", path: "a" })).rejects.toBeInstanceOf(BridgeClosedError);
  });

  it("forwards changed events", () => {
    const { host, changed } = setup();
    host.emitChanged(["papers/a/metadata.yaml"]);
    expect(changed).toEqual([["papers/a/metadata.yaml"]]);
  });

  it.each([
    ["listDir", { op: "listDir", path: "" }, { names: ["a", 3] }],
    ["listDir", { op: "listDir", path: "" }, {}],
    ["stat", { op: "stat", path: "a" }, { stat: { isFile: "yes" } }],
    ["stat", { op: "stat", path: "a" }, {}],
    ["stat", { op: "stat", path: "a" }, { done: true, size: 0 }],
    ["deleteFile", { op: "deleteFile", path: "a" }, null],
  ] as const)("rejects a malformed %s reply as a protocol error", async (op, body, reply) => {
    const { host, connection } = setup();
    host.replies.set(op, reply);
    await expect(connection.request(body)).rejects.toMatchObject({ code: "protocol" });
    host.replies.clear();
    await expect(connection.request({ op: "stat", path: "missing" })).resolves.toEqual({ stat: null });
  });

  it("rejects a readFile reply without the done shape as a protocol error", async () => {
    const { host, connection } = setup();
    host.replies.set("readFile", { names: [] });
    await expect(connection.readFile("a")).rejects.toMatchObject({ code: "protocol" });
  });
});
