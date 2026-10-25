// Decides which native-messaging host the standalone binary serves from the name it was started under.
import { BRIDGE_HOST_FLAG, BRIDGE_PROGRAM_NAME } from "./bridgeAlias.js";

export type ServedHost = "bridge" | "helper";

/**
 * `argv0` is the name the process was started as: process.execPath resolves symlinks, so only argv0 still says labshelf-bridge.
 * CONTRACT: documents/contracts/native-host.md#launcher
 */
export function detectServedHost(argv0: string, args: readonly string[]): ServedHost {
  const name = (argv0.split(/[\\/]/).pop() ?? "").toLowerCase().replace(/\.(exe|cmd)$/, "");
  return name === BRIDGE_PROGRAM_NAME || args[0] === BRIDGE_HOST_FLAG ? "bridge" : "helper";
}
