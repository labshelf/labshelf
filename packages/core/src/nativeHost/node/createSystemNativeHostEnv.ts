// Builds the native-host installer's environment from this machine: home, platform, Windows registry and app data, XDG config folder.
import * as os from "node:os";

import type { ILogger } from "../../ports/index.js";
import type { NativeHostEnv } from "./nativeHostEnv.js";
import { runSystemRegistry } from "./runSystemRegistry.js";

export function createSystemNativeHostEnv(logger: ILogger): NativeHostEnv {
  const platform = process.platform;
  const env: NativeHostEnv = { home: os.homedir(), platform, logger };
  const configHome = process.env["XDG_CONFIG_HOME"];
  if (configHome) env.configHome = configHome;
  if (platform === "win32") {
    env.registry = runSystemRegistry;
    const localAppData = process.env["LOCALAPPDATA"];
    if (localAppData) env.localAppData = localAppData;
  }
  return env;
}
