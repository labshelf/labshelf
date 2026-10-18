// Names the log file the bridge host and its installer write to when no library is configured.
import * as path from "node:path";

import { stateDir } from "../../library/node/index.js";

export function bridgeLogPath(): string {
  return path.join(stateDir(), "logs", "bridge.log");
}
