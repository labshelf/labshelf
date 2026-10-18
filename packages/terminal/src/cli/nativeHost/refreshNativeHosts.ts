// Re-points the installed browser launchers at this run's Node and host scripts so they survive a Node or package update.
import { refreshNativeHost, type NativeHostEnv } from "@labshelf/core/nativeHost/node";

import { NATIVE_HOST_COMMANDS, nativeHostSpec, terminalLaunch } from "./nativeHostCommands.js";

/** Never rejects and prints nothing: a launcher that cannot be refreshed is logged and left as it is. */
export async function refreshTerminalLaunchers(env: NativeHostEnv, distDir: string): Promise<void> {
  for (const command of NATIVE_HOST_COMMANDS) {
    try {
      await refreshNativeHost(env, nativeHostSpec(command), terminalLaunch(command, distDir));
    } catch (error) {
      await env.logger.error("terminal/refresh-native-host", error, { command });
    }
  }
}
