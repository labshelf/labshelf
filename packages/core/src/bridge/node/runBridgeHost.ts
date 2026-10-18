/** Runs the Native Messaging host on stdin and stdout until the browser closes the connection. */
import * as path from "node:path";

import { Logger } from "../../logging/index.js";
import { FileLogSink } from "../../logging/node/index.js";
import { deviceLocalLayout, readSharedLibraryRoot, sharedConfigPath, stateDir } from "../../library/node/index.js";
import type { ILogger } from "../../ports/index.js";
import { changedEvents } from "../changedEvents.js";
import { encodeFrame, FrameDecoder } from "../framing.js";
import type { HostMessage } from "../protocol.js";
import { LibraryFileOperations } from "./fileOperations.js";
import { BridgeHostSession } from "./hostSession.js";
import { watchLibrary } from "./libraryWatcher.js";

export interface BridgeHostOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  configFile?: string;
  env?: NodeJS.ProcessEnv;
  watchDebounceMs?: number;
}

function hostLogger(root: string | undefined, env: NodeJS.ProcessEnv): ILogger {
  const logsDir = root ? deviceLocalLayout(root, env).logsDir : path.join(stateDir(env), "logs");
  return new Logger([new FileLogSink(path.join(logsDir, "bridge.log"))]);
}

/** Resolves when the input ends or the host stops on a broken frame or a refused hello; the launcher then exits. */
export async function runBridgeHost(options: BridgeHostOptions = {}): Promise<void> {
  // PLATFORM: stdout carries the Native Messaging frames; anything else written to it breaks the connection.
  const { input = process.stdin, output = process.stdout, env = process.env, watchDebounceMs = 300 } = options;
  const root = await readSharedLibraryRoot(options.configFile ?? sharedConfigPath(env));
  const logger = hostLogger(root, env);
  await logger.log("INFO", "bridge", "Host started", { libraryRoot: root ?? null });
  const logFailure = (action: string) => (error: unknown): void => { void logger.error("bridge", error, { action }); };
  output.on("error", logFailure("write"));
  // The write callback reports a destroyed stdout, where waiting for "drain" would hang forever.
  const send = (message: HostMessage): Promise<void> => new Promise((resolve, reject) => {
    output.write(encodeFrame(message), (error) => (error ? reject(error) : resolve()));
  });
  let broken = false;
  let stop: () => void = () => {};
  const stopped = new Promise<void>((resolve) => { stop = resolve; });
  const close = (): void => {
    broken = true;
    input.pause();
    stop();
  };
  input.once("end", stop);
  const session = new BridgeHostSession({ files: root ? new LibraryFileOperations(root) : undefined, send, logger, close });
  const onChanged = (paths: string[]): void => {
    for (const event of changedEvents(paths)) send(event).catch(logFailure("changed"));
  };
  const stopWatching = root ? watchLibrary(root, onChanged, logger, watchDebounceMs) : undefined;
  const decoder = new FrameDecoder();
  let pending = Promise.resolve();
  input.on("data", (bytes: Uint8Array) => {
    if (broken) return;
    const { messages, error } = decoder.push(bytes);
    for (const message of messages) pending = session.receive(message);
    if (!error) return;
    // A broken frame leaves the stream unreadable, so the host answers once and stops reading.
    void logger.error("bridge", error, { action: "decode" });
    pending = pending.then(() => send({ id: null, ok: false, error: error.toBody() })).catch(logFailure("send"));
    close();
  });
  await stopped;
  // INVARIANT: pending chains every answer, so exit waits for in-flight writes and commits.
  await pending;
  stopWatching?.();
  await logger.log("INFO", "bridge", "Host stopped", {});
}
