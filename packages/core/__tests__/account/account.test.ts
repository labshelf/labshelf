/** @jest-environment jsdom */
import {
  createAccountClient, createAccountSource, serveAccount,
  type AccountActionResult, type AccountHost, type AccountPort, type AccountRemote, type AccountRemoteDetails, type AccountState, type AccountToHost, type HostToAccount,
} from "../../src/account/account.js";
import { DETAILS, RELAY, stateOf, viewPort } from "./accountFixtures.js";
import { createLoopbackTransport } from "../../src/libraryUi/protocol/transport.js";

const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

type SetResult = { ok: true } | { ok: false; message: string };


type RemoteActions = Pick<AccountRemote, "details" | "estimatePaperPdfs" | "setIncludePdfs" | "setLimit" | "moveStore">;

function fakeRemote(initial: boolean, setImpl?: (on: boolean) => Promise<SetResult>, actions: Partial<RemoteActions> = {}): AccountRemote & { calls: boolean[]; acted: unknown[] } {
  let current = initial;
  const calls: boolean[] = [];
  const acted: unknown[] = [];
  const ok = async (call: unknown): Promise<AccountActionResult> => { acted.push(call); return { ok: true }; };
  return {
    calls,
    acted,
    read: async () => ({ on: current }),
    set: async (on) => {
      calls.push(on);
      const result = setImpl ? await setImpl(on) : ({ ok: true } as SetResult);
      if (result.ok) current = on;
      return result;
    },
    details: async () => DETAILS,
    estimatePaperPdfs: async () => ({ bytes: 300_000_000, files: 12 }),
    setIncludePdfs: (on) => ok({ includePdfs: on }),
    setLimit: (bytes) => ok({ limit: bytes }),
    moveStore: (store) => ok({ move: store }),
    ...actions,
  };
}

function hostWith(options: { relayUrl?: string | undefined; email?: string; remote?: AccountRemote | undefined }): AccountHost {
  return {
    readUserName: async () => "Ada",
    writeUserName: async () => undefined,
    cloudflare: () => ({
      status: async () => (options.relayUrl ? { relayUrl: options.relayUrl, ...(options.email ? { email: options.email } : {}) } : undefined),
      connect: async () => undefined,
      disconnect: async () => undefined,
    }),
    remoteAccess: options.remote ? () => options.remote : undefined,
  };
}

function collect(source: { watch(listener: (state: AccountState) => void): () => void }): AccountState[] {
  const states: AccountState[] = [];
  source.watch((state) => { states.push(state); });
  return states;
}

describe("Account source remote access", () => {
  it("7.1a reports remote access available and its current value when the host answers and Cloudflare is connected", async () => {
    const source = createAccountSource(hostWith({ relayUrl: RELAY, remote: fakeRemote(true) }));
    const states = collect(source);
    await flush();
    const state = states[states.length - 1]!;
    expect(state.remoteAccess.available).toBe(true);
    expect(state.remoteAccess.on).toBe(true);
    expect(state.remoteAccess.busy).toBe(false);
    expect(state.remoteAccess.message).toBeUndefined();
  });

  it("7.1a reports remote access unavailable when Cloudflare is not connected", async () => {
    const source = createAccountSource(hostWith({ relayUrl: undefined, remote: fakeRemote(false) }));
    const states = collect(source);
    await flush();
    const state = states[states.length - 1]!;
    expect(state.relayUrl).toBeUndefined();
    expect(state.remoteAccess.available).toBe(false);
    expect(state.remoteAccess.busy).toBe(false);
  });

  it("7.1a reports remote access unavailable when the host has no remote access", async () => {
    const source = createAccountSource(hostWith({ relayUrl: RELAY }));
    const states = collect(source);
    await flush();
    const state = states[states.length - 1]!;
    expect(state.relayUrl).toBe(RELAY);
    expect(state.remoteAccess.available).toBe(false);
    expect(state.remoteAccess.busy).toBe(false);
  });

  it("7.1b posts a busy state while set() is pending and the new value once it settles", async () => {
    const gate = deferred<SetResult>();
    const remote = fakeRemote(false, () => gate.promise);
    const source = createAccountSource(hostWith({ relayUrl: RELAY, remote }));
    const states = collect(source);
    await flush();

    const acting = source.setRemoteAccess(true);
    await flush();
    expect(remote.calls).toEqual([true]);
    const during = states[states.length - 1]!;
    expect(during.remoteAccess.busy).toBe(true);
    expect(during.remoteAccess.on).toBe(false);

    gate.resolve({ ok: true });
    await acting;
    await flush();
    const after = states[states.length - 1]!;
    expect(after.remoteAccess.busy).toBe(false);
    expect(after.remoteAccess.on).toBe(true);
    expect(after.remoteAccess.message).toBeUndefined();
  });

  it("7.1b keeps the old value and shows the message when set() fails", async () => {
    const remote = fakeRemote(false, async () => ({ ok: false, message: "Could not reach Cloudflare" }));
    const source = createAccountSource(hostWith({ relayUrl: RELAY, remote }));
    const states = collect(source);
    await flush();

    await source.setRemoteAccess(true);
    await flush();
    const after = states[states.length - 1]!;
    expect(after.remoteAccess.busy).toBe(false);
    expect(after.remoteAccess.on).toBe(false);
    expect(after.remoteAccess.message).toBe("Could not reach Cloudflare");
  });

  it("7.1b drops the failure message once a later toggle succeeds", async () => {
    let attempts = 0;
    const remote = fakeRemote(false, async () => (++attempts === 1 ? { ok: false, message: "Nope" } : { ok: true }));
    const source = createAccountSource(hostWith({ relayUrl: RELAY, remote }));
    const states = collect(source);
    await flush();

    await source.setRemoteAccess(true);
    await flush();
    expect(states[states.length - 1]!.remoteAccess.message).toBe("Nope");

    await source.setRemoteAccess(true);
    await flush();
    const after = states[states.length - 1]!;
    expect(after.remoteAccess.on).toBe(true);
    expect(after.remoteAccess.message).toBeUndefined();
  });

  it("7.1b does nothing when the host has no remote access", async () => {
    const source = createAccountSource(hostWith({ relayUrl: RELAY }));
    const states = collect(source);
    await flush();
    await expect(source.setRemoteAccess(true)).resolves.toBeUndefined();
    await flush();
    const state = states[states.length - 1]!;
    expect(state.remoteAccess.on).toBe(false);
    expect(state.remoteAccess.busy).toBe(false);
  });
});

describe("Account webview messages for remote access", () => {
  it("7.1b serveAccount passes account.setRemoteAccess to the port", () => {
    const channel = createLoopbackTransport<AccountToHost, HostToAccount>();
    const calls: boolean[] = [];
    const port: AccountPort = {
      watch: () => () => undefined,
      saveUserName: async () => undefined,
      connectCloudflare: async () => undefined,
      disconnectCloudflare: async () => undefined,
      setRemoteAccess: async (on) => { calls.push(on); },
      estimatePaperPdfs: async () => ({ bytes: 0, files: 0 }),
      setIncludePdfs: async () => undefined,
      setStorageLimit: async () => undefined,
      moveStore: async () => undefined,
    };
    const stop = serveAccount(channel.host, port);
    channel.ui.post({ type: "account.setRemoteAccess", on: true });
    channel.ui.post({ type: "account.setRemoteAccess", on: false });
    stop();
    expect(calls).toEqual([true, false]);
  });

  it("7.1b the client posts account.setRemoteAccess with the wanted value", async () => {
    const posted: AccountToHost[] = [];
    const client = createAccountClient({ post: (message) => { posted.push(message); }, subscribe: () => () => undefined });
    await client.setRemoteAccess(true);
    expect(posted).toEqual([{ type: "account.setRemoteAccess", on: true }]);
  });

  it("7.1b a client toggle reaches the source behind serveAccount and the busy state returns to the client", async () => {
    const gate = deferred<SetResult>();
    const remote = fakeRemote(false, () => gate.promise);
    const source = createAccountSource(hostWith({ relayUrl: RELAY, remote }));
    const channel = createLoopbackTransport<AccountToHost, HostToAccount>();
    const stop = serveAccount(channel.host, source);
    const client = createAccountClient(channel.ui);
    const states = collect(client);
    await flush();

    await client.setRemoteAccess(true);
    await flush();
    expect(remote.calls).toEqual([true]);
    expect(states[states.length - 1]!.remoteAccess.busy).toBe(true);

    gate.resolve({ ok: true });
    await flush();
    const after = states[states.length - 1]!;
    expect(after.remoteAccess.busy).toBe(false);
    expect(after.remoteAccess.on).toBe(true);
    stop();
  });
});

// ---- The store of a remote library that is on
describe("Account source remote store", () => {
  const last = (states: AccountState[]): AccountState => states[states.length - 1]!;

  it("passes the Cloudflare email and the store details while remote access is on", async () => {
    const states = collect(createAccountSource(hostWith({ relayUrl: RELAY, email: "ada@example.org", remote: fakeRemote(true) })));
    await flush();
    expect(last(states).cloudflareEmail).toBe("ada@example.org");
    expect(last(states).remoteAccess.details).toEqual(DETAILS);
  });

  it("does not read the details while remote access is off, and leaves them out when they fail", async () => {
    const details = jest.fn(async () => DETAILS);
    const off = collect(createAccountSource(hostWith({ relayUrl: RELAY, remote: fakeRemote(false, undefined, { details }) })));
    const failing = collect(createAccountSource(hostWith({ relayUrl: RELAY, remote: fakeRemote(true, undefined, { details: async () => { throw new Error("offline"); } }) })));
    await flush();
    expect(details).not.toHaveBeenCalled();
    expect(last(off).remoteAccess.details).toBeUndefined();
    expect(last(failing).remoteAccess.details).toBeUndefined();
    expect(last(failing).remoteAccess.on).toBe(true);
  });

  it("runs the limit, paper PDFs and move actions through the remote", async () => {
    const remote = fakeRemote(true);
    const source = createAccountSource(hostWith({ relayUrl: RELAY, remote }));
    await source.setStorageLimit(2_000_000_000);
    await source.setStorageLimit(null);
    await source.setIncludePdfs(true);
    await source.moveStore("r2");
    expect(remote.acted).toEqual([{ limit: 2_000_000_000 }, { limit: null }, { includePdfs: true }, { move: "r2" }]);
  });

  it("shows busy during a move and keeps a Cloudflare refusal as the message", async () => {
    const gate = deferred<AccountActionResult>();
    const source = createAccountSource(hostWith({ relayUrl: RELAY, remote: fakeRemote(true, undefined, { moveStore: () => gate.promise }) }));
    const states = collect(source);
    await flush();
    const moving = source.moveStore("r2");
    await flush();
    expect(last(states).remoteAccess.busy).toBe(true);
    gate.resolve({ ok: false, message: "Cloudflare refused: no R2 bucket named labshelf-mirror" });
    await moving;
    expect(last(states).remoteAccess.busy).toBe(false);
    expect(last(states).remoteAccess.message).toBe("Cloudflare refused: no R2 bucket named labshelf-mirror");
  });

  it("words a thrown action as its own failure", async () => {
    const source = createAccountSource(hostWith({ relayUrl: RELAY, remote: fakeRemote(true, undefined, { setLimit: async () => { throw new Error("boom"); } }) }));
    const states = collect(source);
    await source.setStorageLimit(1_000_000_000);
    expect(last(states).remoteAccess.message).toBe("Could not save the limit");
  });

  it("answers the paper PDFs estimate, and rejects with a message to show when the remote fails", async () => {
    const ok = createAccountSource(hostWith({ relayUrl: RELAY, remote: fakeRemote(true) }));
    const failing = createAccountSource(hostWith({ relayUrl: RELAY, remote: fakeRemote(true, undefined, { estimatePaperPdfs: async () => { throw new Error("offline"); } }) }));
    await expect(ok.estimatePaperPdfs()).resolves.toEqual({ bytes: 300_000_000, files: 12 });
    await expect(failing.estimatePaperPdfs()).rejects.toThrow("Could not estimate the size of the paper PDFs");
  });
});

describe("Account webview messages for the remote store", () => {
  it("carries the estimate request and its answer, or its failure, across the channel", async () => {
    const channel = createLoopbackTransport<AccountToHost, HostToAccount>();
    let fail = false;
    const port = viewPort(stateOf({ available: true, on: true, busy: false }), async () => {
      if (fail) throw new Error("No library open");
      return { bytes: 42, files: 2 };
    });
    const stop = serveAccount(channel.host, port);
    const client = createAccountClient(channel.ui);
    await expect(client.estimatePaperPdfs()).resolves.toEqual({ bytes: 42, files: 2 });
    fail = true;
    await expect(client.estimatePaperPdfs()).rejects.toThrow("No library open");
    stop();
  });

  it("passes the limit, paper PDFs and move messages to the port", async () => {
    const channel = createLoopbackTransport<AccountToHost, HostToAccount>();
    const port = viewPort(stateOf({ available: true, on: true, busy: false }));
    const stop = serveAccount(channel.host, port);
    const client = createAccountClient(channel.ui);
    await client.setStorageLimit(null);
    await client.setIncludePdfs(false);
    await client.moveStore("do");
    stop();
    expect(port.acted).toEqual([{ limit: null }, { includePdfs: false }, { move: "do" }]);
  });
});
