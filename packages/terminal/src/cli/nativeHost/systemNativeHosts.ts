// Runs the native-host commands and the launcher refresh against this machine's browsers, logging to the bridge log.
import { Logger } from "@labshelf/core";
import { FileLogSink, bridgeLogPath } from "@labshelf/core/node";
import {
  systemNativeHostEnv,
  refreshNativeHost,
  type NativeHostEnv,
} from "@labshelf/core/nativeHost/node";

import type { Output } from "../usage.js";
import {
  runNativeHostCommand,
  terminalLaunch,
  type NativeHostCommand,
  NATIVE_HOST_COMMANDS,
  nativeHostSpec,
} from "./nativeHostCommands.js";

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

export function isNativeHostCommand(command: string | undefined): command is NativeHostCommand {
  return command === "bridge" || command === "helper";
}

function systemEnv(): ReturnType<typeof systemNativeHostEnv> {
  return systemNativeHostEnv(new Logger([new FileLogSink(bridgeLogPath())], { onSinkError: () => undefined }));
}

export function runSystemNativeHostCommand(
  command: NativeHostCommand, subcommand: string | undefined, flags: { replace: boolean }, io: Output, distDir: string,
): Promise<number> {
  return runNativeHostCommand(command, subcommand, flags, io, systemEnv(), terminalLaunch(command, distDir));
}

export function refreshSystemLaunchers(distDir: string): Promise<void> {
  return refreshTerminalLaunchers(systemEnv(), distDir);
}
