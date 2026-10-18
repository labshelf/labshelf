// Is the process entry of the bridge host: serves one browser connection, then exits.
import { runBridgeHost } from "./runBridgeHost.js";

// PLATFORM: stdout carries the Native Messaging frames, so failures go to stderr only.
runBridgeHost().then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(`labshelf bridge host failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exit(1);
  },
);
