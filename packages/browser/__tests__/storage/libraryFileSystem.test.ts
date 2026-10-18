// Pins how the library picks the folder or browser storage, keeps that choice and routes every call to one source.
import type { LibraryFileSystem } from "@labshelf/core";
import { createLibrarySources } from "../../src/storage/libraryFileSystem";
import { FakeBridgeHost, silentLogger } from "./bridge/fakeBridgeHost";

function setup(configure: (host: FakeBridgeHost, index: number) => void = () => undefined) {
  const hosts: FakeBridgeHost[] = [];
  const browserFs = { readText: jest.fn(async () => "from browser") } as unknown as LibraryFileSystem;
  const sources = createLibrarySources({
    connect: () => {
      const host = new FakeBridgeHost();
      host.files.set("a.txt", new TextEncoder().encode("from folder"));
      configure(host, hosts.length);
      hosts.push(host);
      return host;
    },
    logger: silentLogger,
    browserFs,
  });
  return { hosts, browserFs, ...sources };
}

describe("library source choice", () => {
  it("uses the folder through the bridge when hello succeeds", async () => {
    const { fileSystem, getLibrarySource, browserFs } = setup();
    await expect(getLibrarySource()).resolves.toEqual({ kind: "folder", root: "/home/me/Library" });
    await expect(fileSystem.readText("a.txt")).resolves.toBe("from folder");
    expect(browserFs.readText).not.toHaveBeenCalled();
  });

  it.each([
    ["not-installed", (host: FakeBridgeHost) => { host.missingReason = "Specified native messaging host not found."; }],
    ["protocol-mismatch", (host: FakeBridgeHost) => { host.protocol = 1; }],
    ["no-library", (host: FakeBridgeHost) => { host.libraryRoot = undefined; }],
  ])("falls back to browser storage with reason %s", async (reason, configure) => {
    const { fileSystem, getLibrarySource, hosts } = setup(configure);
    await expect(getLibrarySource()).resolves.toMatchObject({ kind: "browser", reason });
    await expect(fileSystem.readText("a.txt")).resolves.toBe("from browser");
    expect(hosts[0]!.ofOp("readFile")).toHaveLength(0);
  });

  it("reports any other failure as failed with its message", async () => {
    const { getLibrarySource } = setup(() => { throw new Error("connectNative is not a function"); });
    await expect(getLibrarySource()).resolves.toEqual({ kind: "browser", reason: "failed", detail: "connectNative is not a function" });
  });

  it("probes once and keeps the choice", async () => {
    const { fileSystem, getLibrarySource, hosts } = setup();
    await getLibrarySource();
    await fileSystem.readText("a.txt");
    await fileSystem.readText("a.txt");
    expect(hosts).toHaveLength(1);
    expect(hosts[0]!.ofOp("hello")).toHaveLength(1);
  });

  it("keeps the folder after the link dies: calls fail until the bridge is back, never reaching browser storage", async () => {
    let hostUp = true;
    const { fileSystem, getLibrarySource, hosts, browserFs } = setup((host, index) => {
      if (index > 0 && !hostUp) host.missingReason = "Specified native messaging host not found.";
      if (index > 0) host.libraryRoot = "/home/me/Moved";
    });
    await expect(fileSystem.readText("a.txt")).resolves.toBe("from folder");

    hostUp = false;
    hosts[0]!.mute.add("readFile");
    const pending = fileSystem.readText("a.txt");
    await new Promise((resolve) => setTimeout(resolve, 0));
    hosts[0]!.close("Native host has exited.");
    await expect(pending).rejects.toThrow();
    await expect(fileSystem.readText("a.txt")).rejects.toThrow();
    await expect(fileSystem.writeText("b.txt", "x")).rejects.toThrow();
    await expect(getLibrarySource()).resolves.toEqual({ kind: "folder", root: "/home/me/Library" });
    expect(browserFs.readText).not.toHaveBeenCalled();
    expect(hosts.length).toBeGreaterThan(1);

    hostUp = true;
    await expect(fileSystem.readText("a.txt")).resolves.toBe("from folder");
    await expect(getLibrarySource()).resolves.toEqual({ kind: "folder", root: "/home/me/Moved" });
    expect(browserFs.readText).not.toHaveBeenCalled();
  });

  it("probes again on recheck after browser storage was chosen", async () => {
    const { fileSystem, getLibrarySource, recheckLibrarySource, browserFs } = setup((host, index) => {
      if (index === 0) host.missingReason = "Specified native messaging host not found.";
    });
    await expect(getLibrarySource()).resolves.toMatchObject({ kind: "browser", reason: "not-installed" });
    await expect(recheckLibrarySource()).resolves.toEqual({ kind: "folder", root: "/home/me/Library" });
    await expect(getLibrarySource()).resolves.toEqual({ kind: "folder", root: "/home/me/Library" });
    await expect(fileSystem.readText("a.txt")).resolves.toBe("from folder");
    expect(browserFs.readText).not.toHaveBeenCalled();
  });

  it("probes again once a browser storage choice is a minute old", async () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(0);
    const { getLibrarySource, hosts } = setup((host, index) => {
      if (index === 0) host.missingReason = "Specified native messaging host not found.";
    });
    await expect(getLibrarySource()).resolves.toMatchObject({ kind: "browser" });
    now.mockReturnValue(59_000);
    await expect(getLibrarySource()).resolves.toMatchObject({ kind: "browser" });
    expect(hosts).toHaveLength(1);
    now.mockReturnValue(61_000);
    await expect(getLibrarySource()).resolves.toEqual({ kind: "folder", root: "/home/me/Library" });
    now.mockRestore();
  });

  it("forwards bridge changed events to subscribers", async () => {
    const { getLibrarySource, onLibraryFilesChanged, hosts } = setup();
    const seen: string[][] = [];
    onLibraryFilesChanged((paths) => seen.push(paths));
    await getLibrarySource();
    hosts[0]!.emitChanged(["papers/a/metadata.yaml"]);
    expect(seen).toEqual([["papers/a/metadata.yaml"]]);
  });
});
