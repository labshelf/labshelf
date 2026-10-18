// Pins choosing the library folder through the bridge when the host answers hello with noLibrary.
import { BridgeError } from "@labshelf/core";
import { setBridgeLibrary } from "../../../src/storage/bridge";
import { FakeBridgeHost, silentLogger } from "./fakeBridgeHost";

describe("setBridgeLibrary", () => {
  it("greets the host, sets the folder and closes the connection", async () => {
    const host = new FakeBridgeHost();
    host.libraryRoot = undefined;

    await expect(setBridgeLibrary(() => host, silentLogger, "/home/me/LabShelf")).resolves.toEqual({ libraryRoot: "/home/me/LabShelf", paperCount: 0 });

    expect(host.posted.map((m) => m.op)).toEqual(["hello", "setLibrary"]);
    expect(host.libraryRoot).toBe("/home/me/LabShelf");
    expect(host.disconnected).toBe(true);
  });

  it("surfaces the host's refusal and still closes the connection", async () => {
    const host = new FakeBridgeHost();
    host.libraryRoot = undefined;

    await expect(setBridgeLibrary(() => host, silentLogger, "/missing/folder"))
      .rejects.toEqual(expect.objectContaining({ code: "noLibrary", message: expect.stringContaining("/missing/folder") }));
    expect(host.disconnected).toBe(true);
  });

  it("refuses a host that speaks another protocol version", async () => {
    const host = new FakeBridgeHost();
    host.libraryRoot = undefined;
    host.protocol = 1;

    await expect(setBridgeLibrary(() => host, silentLogger, "/home/me/LabShelf")).rejects.toBeInstanceOf(BridgeError);
    expect(host.ofOp("setLibrary")).toEqual([]);
  });
});
