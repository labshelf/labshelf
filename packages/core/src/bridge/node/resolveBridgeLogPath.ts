// Names the log file the bridge host and its installer write to when no library is configured.
import * as path from "node:path";

import { resolveDeviceStateDir } from "../../library/node/index.js";

export function resolveBridgeLogPath(): string {
  return path.join(resolveDeviceStateDir(), "logs", "bridge.log");
}
