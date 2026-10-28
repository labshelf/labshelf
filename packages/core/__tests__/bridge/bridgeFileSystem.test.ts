// Pins the bridge file system over a fake host: connecting, renames, deletes, reconnects and changed events.
import { BridgeFileSystem, BridgeClient } from "../../src/bridge";
import { FakeBridgeHost, silentLogger } from "./fakeBridgeHost";

function setup() {
  const hosts: FakeBridgeHost[] = [];
  const link = new BridgeClient(() => {
    const host = new FakeBridgeHost();
    if (hosts.length > 0) host.files = hosts[0]!.files;
    hosts.push(host);
    return host;
  }, silentLogger);
  const fs = new BridgeFileSystem(async () => (await link.open()).connection);
  return { hosts, link, fs };
}

describe("BridgeFileSystem", () => {
  it("connects on first use and says hello once", async () => {
    const { hosts, fs } = setup();
    await fs.writeText("a.txt", "hello");
    await expect(fs.readText("a.txt")).resolves.toBe("hello");
    expect(hosts).toHaveLength(1);
    expect(hosts[0]!.ofOp("hello")).toHaveLength(1);
  });

  it("refuses a rename onto an existing target and leaves both files", async () => {
    const { hosts, fs } = setup();
    await fs.writeText("a.txt", "a");
    await fs.writeText("b.txt", "b");

    await expect(fs.rename("a.txt", "b.txt")).rejects.toThrow(/exists/);

    expect(hosts[0]!.ofOp("rename")).toHaveLength(0);
    await expect(fs.readText("b.txt")).resolves.toBe("b");
  });

  it("allows a rename that changes only letter case", async () => {
    const { fs } = setup();
    await fs.writeText("a.txt", "a");
    await fs.rename("a.txt", "A.txt");
    await expect(fs.readText("A.txt")).resolves.toBe("a");
  });

  it("refuses a case-only rename when the folder lists the exact target name", async () => {
    const { hosts, fs } = setup();
    await fs.writeText("papers/a.txt", "a");
    await fs.writeText("papers/A.txt", "A");

    await expect(fs.rename("papers/a.txt", "papers/A.txt")).rejects.toMatchObject({ code: "io", message: expect.stringMatching(/already exists/) });
    expect(hosts[0]!.ofOp("rename")).toHaveLength(0);
    expect(hosts[0]!.files.size).toBe(2);
  });

  it("trashes a folder with deleteDir and a file with deleteFile", async () => {
    const { hosts, fs } = setup();
    await fs.mkdir("papers/x");
    await fs.writeText("papers/y.txt", "y");

    await fs.trash("papers/x");
    await fs.trash("papers/y.txt");

    expect(hosts[0]!.ofOp("deleteDir").map((m) => m.path)).toEqual(["papers/x"]);
    expect(hosts[0]!.ofOp("deleteFile").map((m) => m.path)).toEqual(["papers/y.txt"]);
  });

  it("reconnects and says hello again after the port dies", async () => {
    const { hosts, fs } = setup();
    await fs.writeText("a.txt", "a");

    hosts[0]!.close();

    await expect(fs.readText("a.txt")).resolves.toBe("a");
    expect(hosts).toHaveLength(2);
    expect(hosts[1]!.ofOp("hello")).toHaveLength(1);
  });

  it("delivers changed events from every connection to subscribers until they unsubscribe", async () => {
    const { hosts, link, fs } = setup();
    const seen: string[][] = [];
    const unsubscribe = link.onChanged((paths) => seen.push(paths));
    await fs.exists("a");
    hosts[0]!.emitChanged(["one"]);
    hosts[0]!.close();
    await fs.exists("a");
    hosts[1]!.emitChanged(["two"]);
    unsubscribe();
    hosts[1]!.emitChanged(["three"]);

    expect(seen).toEqual([["one"], ["two"]]);
  });
});
