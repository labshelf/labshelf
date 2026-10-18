/** Runs the bridge host over in-memory streams so tests talk to it as the browser does. */
import { PassThrough } from "node:stream";
import * as path from "node:path";

import { BRIDGE_PROTOCOL, BROWSER_MESSAGE_LIMIT, encodeFrame, FrameDecoder, type HostMessage } from "../../../src/bridge/index";
import { runBridgeHost } from "../../../src/bridge/node/index";
import { updateSharedConfig } from "../../../src/library/node/index";
import { makeTempDir } from "../../support/tempDirs";

export interface BridgeHarness {
  send(message: unknown): void;
  /** Writes raw bytes, for frames the encoder refuses to build. */
  sendBytes(bytes: Uint8Array): void;
  /** Sends a matching hello with id 0 and returns its reply. */
  hello(): Promise<HostMessage[]>;
  /** Sends a request and collects the messages for its id up to its response. */
  call(message: { id: number } & Record<string, unknown>): Promise<HostMessage[]>;
  next(match: (message: HostMessage) => boolean): Promise<HostMessage>;
  close(): Promise<void>;
  /** Resolves when the host stops on its own or after `close`. */
  finished: Promise<void>;
  /** The shared config file the host reads and writes. */
  configFile: string;
}

export async function startBridge(libraryRoot: string | undefined): Promise<BridgeHarness> {
  const home = await makeTempDir();
  const configFile = path.join(home, "config.json");
  if (libraryRoot) { await updateSharedConfig({ libraryRoot }, configFile); }
  const input = new PassThrough();
  const output = new PassThrough();
  const received: HostMessage[] = [];
  let waiters: Array<() => void> = [];
  const decoder = new FrameDecoder();
  output.on("data", (bytes: Buffer) => {
    const { messages, error } = decoder.push(new Uint8Array(bytes));
    if (error) { throw error; }
    received.push(...(messages as HostMessage[]));
    const pending = waiters;
    waiters = [];
    pending.forEach((wake) => wake());
  });
  const run = runBridgeHost({ input, output, configFile, env: { XDG_STATE_HOME: home, XDG_CACHE_HOME: home }, watchDebounceMs: 50 });

  async function next(match: (message: HostMessage) => boolean): Promise<HostMessage> {
    for (;;) {
      const index = received.findIndex(match);
      if (index >= 0) { return received.splice(index, 1)[0] as HostMessage; }
      await new Promise<void>((wake) => waiters.push(wake));
    }
  }
  const send = (message: unknown): void => { input.write(encodeFrame(message, BROWSER_MESSAGE_LIMIT)); };
  async function call(message: { id: number } & Record<string, unknown>): Promise<HostMessage[]> {
    send(message);
    const collected: HostMessage[] = [];
    for (;;) {
      const reply = await next((m) => "id" in m && m.id === message.id);
      collected.push(reply);
      if ("ok" in reply) { return collected; }
    }
  }
  return {
    send,
    sendBytes: (bytes) => { input.write(bytes); },
    hello: () => call({ id: 0, op: "hello", protocol: BRIDGE_PROTOCOL }),
    next,
    call,
    async close() { input.end(); await run; },
    finished: run,
    configFile,
  };
}
