// Tests that refreshTerminalLaunchers refreshes both hosts with this app's launch and never rejects.
import path from "node:path";

import { type NativeHostEnv, refreshNativeHost } from "@labshelf/core/nativeHost/node";
import { refreshTerminalLaunchers } from "../../../src/cli/nativeHost/systemNativeHosts";

jest.mock("@labshelf/core/nativeHost/node", () => ({
  ...jest.requireActual("@labshelf/core/nativeHost/node"),
  refreshNativeHost: jest.fn(),
}));

const refresh = refreshNativeHost as jest.MockedFunction<typeof refreshNativeHost>;
const errors: { module: string; error: unknown }[] = [];
const env = { home: "/home/a", platform: "linux", logger: { log: async () => undefined, error: async (module: string, error: unknown) => { errors.push({ module, error }); } } } as unknown as NativeHostEnv;

describe("refreshTerminalLaunchers", () => {
  beforeEach(() => { errors.length = 0; refresh.mockReset(); });

  it("refreshes the bridge and the helper launcher with this app's host scripts", async () => {
    refresh.mockResolvedValue("unchanged");
    await refreshTerminalLaunchers(env, "/new/dist");
    expect(refresh.mock.calls.map(([, spec, launch]) => [spec.dirName, launch.hostScript])).toEqual([
      ["bridge", path.join("/new/dist", "bridgeHost.js")],
      ["helper", path.join("/new/dist", "helperHost.mjs")],
    ]);
    expect(refresh.mock.calls[0]![2]).toMatchObject({ kind: "script", owner: "terminal" });
  });

  it("logs a failure, still refreshes the other host and resolves", async () => {
    refresh.mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce("refreshed");
    await expect(refreshTerminalLaunchers(env, "/new/dist")).resolves.toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(errors).toHaveLength(1);
  });
});
