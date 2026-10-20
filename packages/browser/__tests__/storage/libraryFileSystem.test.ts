// Pins how the library picks the folder or browser storage, keeps that choice and routes every call to one source.
import type { LibraryFileSystem } from "@labshelf/core";
import { createLibrarySources, type PickedFolder } from "../../src/storage/libraryFileSystem";
import { FakeBridgeHost, silentLogger } from "./bridge/fakeBridgeHost";

function setup(configure: (host: FakeBridgeHost, index: number) => void = () => undefined) {
  const hosts: FakeBridgeHost[] = [];
  const picked: { folder?: PickedFolder; failure?: Error; announce: () => void } = { announce: () => undefined };
  const browserFs = { readText: jest.fn(async () => "from browser") } as unknown as LibraryFileSystem;
  const rebuild = jest.fn(async (_fs: LibraryFileSystem) => undefined);
  const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
  const sources = createLibrarySources({
    connect: () => {
      const host = new FakeBridgeHost();
      host.files.set("a.txt", new TextEncoder().encode("from folder"));
      configure(host, hosts.length);
      hosts.push(host);
      return host;
    },
    pickedFolder: async () => {
      if (picked.failure) throw picked.failure;
      return picked.folder;
    },
    onPickedFolderAnnounced: (listener) => { picked.announce = listener; },
    logger: { ...silentLogger, ...logger },
    browserFs,
    rebuild,
  });
  return { hosts, browserFs, rebuild, logger, picked, ...sources };
}

describe("library source choice", () => {
  it("uses the folder through the bridge when hello succeeds", async () => {
    const { fileSystem, getLibrarySource, browserFs } = setup();
    await expect(getLibrarySource()).resolves.toEqual({ kind: "folder", root: "/home/me/Library", via: "bridge" });
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
    await expect(getLibrarySource()).resolves.toEqual({ kind: "folder", root: "/home/me/Library", via: "bridge" });
    expect(browserFs.readText).not.toHaveBeenCalled();
    expect(hosts.length).toBeGreaterThan(1);

    hostUp = true;
    await expect(fileSystem.readText("a.txt")).resolves.toBe("from folder");
    await expect(getLibrarySource()).resolves.toEqual({ kind: "folder", root: "/home/me/Moved", via: "bridge" });
    expect(browserFs.readText).not.toHaveBeenCalled();
  });

  it("probes again on recheck after browser storage was chosen", async () => {
    const { fileSystem, getLibrarySource, recheckLibrarySource, browserFs } = setup((host, index) => {
      if (index === 0) host.missingReason = "Specified native messaging host not found.";
    });
    await expect(getLibrarySource()).resolves.toMatchObject({ kind: "browser", reason: "not-installed" });
    await expect(recheckLibrarySource()).resolves.toEqual({ kind: "folder", root: "/home/me/Library", via: "bridge" });
    await expect(getLibrarySource()).resolves.toEqual({ kind: "folder", root: "/home/me/Library", via: "bridge" });
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
    await expect(getLibrarySource()).resolves.toEqual({ kind: "folder", root: "/home/me/Library", via: "bridge" });
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

  describe("paper cache rebuild", () => {
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
    const absent = (host: FakeBridgeHost, index: number): void => {
      if (index === 0) host.missingReason = "Specified native messaging host not found.";
    };

    it("rebuilds once from the folder when the probe first selects it", async () => {
      const { fileSystem, getLibrarySource, recheckLibrarySource, rebuild } = setup();
      await getLibrarySource();
      await fileSystem.readText("a.txt");
      await recheckLibrarySource();
      await settle();
      expect(rebuild).toHaveBeenCalledTimes(1);
      await expect(rebuild.mock.calls[0]![0].readText("a.txt")).resolves.toBe("from folder");
    });

    it("rebuilds when a recheck switches browser storage to the folder, and not while on browser storage", async () => {
      const { getLibrarySource, recheckLibrarySource, rebuild } = setup(absent);
      await getLibrarySource();
      await settle();
      expect(rebuild).not.toHaveBeenCalled();
      await recheckLibrarySource();
      await settle();
      expect(rebuild).toHaveBeenCalledTimes(1);
    });

    it("keeps the folder and logs when the rebuild fails", async () => {
      const { getLibrarySource, rebuild, logger } = setup();
      rebuild.mockRejectedValueOnce(new Error("scan failed"));
      await expect(getLibrarySource()).resolves.toEqual({ kind: "folder", root: "/home/me/Library", via: "bridge" });
      await settle();
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it("notifies a subscribed listener once when the probe's rebuild finishes, and not after it unsubscribes", async () => {
      const { getLibrarySource, recheckLibrarySource, onFolderRecordsRebuilt } = setup();
      const heard = jest.fn();
      const gone = jest.fn();
      onFolderRecordsRebuilt(heard);
      onFolderRecordsRebuilt(gone)();
      await getLibrarySource();
      await recheckLibrarySource();
      await settle();
      expect(heard).toHaveBeenCalledTimes(1);
      expect(gone).not.toHaveBeenCalled();
    });

    it("does not notify while the rebuild runs or after it fails", async () => {
      const { getLibrarySource, rebuild, onFolderRecordsRebuilt } = setup();
      const heard = jest.fn();
      onFolderRecordsRebuilt(heard);
      let finish = (): void => undefined;
      rebuild.mockImplementationOnce(() => new Promise<undefined>((resolve) => { finish = () => resolve(undefined); }));
      await getLibrarySource();
      await settle();
      expect(heard).not.toHaveBeenCalled();
      finish();
      await settle();
      expect(heard).toHaveBeenCalledTimes(1);
    });

    it("does not notify when the rebuild fails", async () => {
      const { getLibrarySource, rebuild, onFolderRecordsRebuilt } = setup();
      const heard = jest.fn();
      onFolderRecordsRebuilt(heard);
      rebuild.mockRejectedValueOnce(new Error("scan failed"));
      await getLibrarySource();
      await settle();
      expect(heard).not.toHaveBeenCalled();
    });
  });

  describe("folder picked in the browser", () => {
    const pickedFs = (): LibraryFileSystem => ({ readText: jest.fn(async () => "from picked") }) as unknown as LibraryFileSystem;
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

    it("wins over the bridge, routes every call to it and rebuilds from it", async () => {
      const { fileSystem, folderFileSystem, getLibrarySource, recheckLibrarySource, picked, hosts, rebuild } = setup();
      picked.folder = { name: "Papers", fs: pickedFs() };
      await expect(getLibrarySource()).resolves.toEqual({ kind: "folder", root: "Papers", via: "picked" });
      await expect(fileSystem.readText("a.txt")).resolves.toBe("from picked");
      await expect(folderFileSystem.readText("a.txt")).resolves.toBe("from picked");
      await expect(recheckLibrarySource()).resolves.toEqual({ kind: "folder", root: "Papers", via: "picked" });
      await settle();
      expect(hosts).toHaveLength(0);
      expect(rebuild).toHaveBeenCalledWith(picked.folder.fs);
    });

    it("switches from browser storage to the folder when another context announces a pick", async () => {
      const { fileSystem, getLibrarySource, picked, browserFs } = setup((host) => { host.missingReason = "Specified native messaging host not found."; });
      await expect(getLibrarySource()).resolves.toMatchObject({ kind: "browser" });
      picked.folder = { name: "Papers", fs: pickedFs() };
      picked.announce();
      await settle();
      await expect(getLibrarySource()).resolves.toEqual({ kind: "folder", root: "Papers", via: "picked" });
      await expect(fileSystem.readText("a.txt")).resolves.toBe("from picked");
      expect(browserFs.readText).not.toHaveBeenCalled();
    });

    it("leaves the bridge folder for a folder picked in this context", async () => {
      const { fileSystem, getLibrarySource, switchToPickedFolder, picked } = setup();
      await expect(getLibrarySource()).resolves.toMatchObject({ via: "bridge" });
      picked.folder = { name: "Papers", fs: pickedFs() };
      await expect(switchToPickedFolder()).resolves.toEqual({ kind: "folder", root: "Papers", via: "picked" });
      await expect(fileSystem.readText("a.txt")).resolves.toBe("from picked");
    });

    it("logs a failed read of the stored folder and probes the bridge", async () => {
      const { getLibrarySource, logger, picked } = setup();
      picked.failure = new Error("IndexedDB is closed");
      await expect(getLibrarySource()).resolves.toEqual({ kind: "folder", root: "/home/me/Library", via: "bridge" });
      expect(logger.error).toHaveBeenCalledWith(expect.any(String), picked.failure, expect.objectContaining({ op: "loadPickedFolder" }));
    });
  });
});
