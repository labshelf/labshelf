// Builds the bridge installer's environment from this machine: home folder, platform, Windows registry and app data, log file.
import * as os from "node:os";
import * as path from "node:path";

import type { ILogger } from "../../../ports/index.js";
import { stateDir } from "../../../library/node/index.js";
import type { BridgeEnv } from "../install/index.js";
import { systemRegistry } from "./systemRegistry.js";

/** Where the installer and the host log when no library is configured. */
export function bridgeLogPath(): string {
  return path.join(stateDir(), "logs", "bridge.log");
}

export function systemBridgeEnv(logger: ILogger): BridgeEnv {
  const platform = process.platform;
  const env: BridgeEnv = { home: os.homedir(), platform, logger };
  if (platform === "win32") {
    env.registry = systemRegistry;
    const localAppData = process.env["LOCALAPPDATA"];
    if (localAppData) env.localAppData = localAppData;
  }
  return env;
}
