// Rewrites the launchers this extension installed when its install path or Electron binary changed.
import type * as vscode from "vscode";

import type { ILogger } from "@labshelf/core";
import { resolveBridgeLogPath } from "@labshelf/core/node";
import { BRIDGE_HOST_SPEC, HELPER_HOST_SPEC, refreshNativeHost, createSystemNativeHostEnv } from "@labshelf/core/nativeHost/node";

import { scriptLaunch } from "./hostLaunch.js";

const LOG_MODULE = "native-host-refresh";

/** Never installs, prompts or throws: activation must not wait for it or fail because of it. */
export async function refreshNativeHosts(context: vscode.ExtensionContext, createLogger: (logPath: string) => ILogger): Promise<void> {
  const logger = createLogger(resolveBridgeLogPath());
  const env = createSystemNativeHostEnv(logger);
  const specs = [[BRIDGE_HOST_SPEC, "bridgeHost"], [HELPER_HOST_SPEC, "helperHost"]] as const;
  for (const [spec, host] of specs) {
    try {
      const result = await refreshNativeHost(env, spec, scriptLaunch(context, host));
      if (result === "refreshed") await logger.log("INFO", LOG_MODULE, "Refreshed the native host launcher", { host: spec.hostName });
    } catch (error) {
      await logger.error(LOG_MODULE, error, { action: "refresh the native host launcher", host: spec.hostName });
    }
  }
}
