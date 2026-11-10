/** @jest-environment jsdom */
import {
  createAccountClient, createAccountSource, serveAccount,
  type AccountHost, type AccountPort, type AccountRemote, type AccountState, type AccountToHost, type HostToAccount,
} from "../../src/account/account.js";
import { mountAccountView } from "../../src/account/dom/accountView.js";
import { createLoopbackTransport } from "../../src/libraryUi/protocol/transport.js";

const RELAY = "https://labshelf-relay.ada.workers.dev";
const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

type SetResult = { ok: true } | { ok: false; message: string };

function fakeRemote(initial: boolean, setImpl?: (on: boolean) => Promise<SetResult>): AccountRemote & { calls: boolean[] } {
  let current = initial;
  const calls: boolean[] = [];
  return {
    calls,
    read: async () => ({ on: current }),
    set: async (on) => {
      calls.push(on);
      const result = setImpl ? await setImpl(on) : ({ ok: true } as SetResult);
      if (result.ok) current = on;
      return result;
    },
  };
}

function hostWith(options: { relayUrl?: string; remote?: AccountRemote }): AccountHost {
  return {
    readUserName: async () => "Ada",
    writeUserName: async () => undefined,
    cloudflare: () => ({
      status: async () => (options.relayUrl ? { relayUrl: options.relayUrl } : undefined),
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

// ---- The view
type Remote = AccountState["remoteAccess"];

function viewPort(initial: AccountState): AccountPort & { remoteCalls: boolean[]; push(state: AccountState): void } {
  const remoteCalls: boolean[] = [];
  let listener: ((state: AccountState) => void) | undefined;
  return {
    remoteCalls,
    push: (state) => listener?.(state),
    watch: (next) => { listener = next; next(initial); return () => { listener = undefined; }; },
    saveUserName: async () => undefined,
    connectCloudflare: async () => undefined,
    disconnectCloudflare: async () => undefined,
    setRemoteAccess: async (on) => { remoteCalls.push(on); },
  };
}

const stateOf = (remoteAccess: Remote, relayUrl: string | undefined = RELAY, cloudflareAvailable = true): AccountState =>
  ({ userName: "Ada", cloudflareAvailable, relayUrl, remoteAccess });

const switchOf = (root: HTMLElement): HTMLInputElement => root.querySelector("input[role=switch]") as HTMLInputElement;

describe("Account view remote access", () => {
  it("7.1a disables the switch and says to connect Cloudflare first when Cloudflare is not connected", () => {
    const root = document.createElement("div");
    mountAccountView(root, viewPort(stateOf({ available: false, on: false, busy: false }, undefined)));
    expect(switchOf(root).disabled).toBe(true);
    expect(root.textContent).toContain("Connect Cloudflare first");
  });

  it("7.1a disables the switch when the app has no remote access, without asking to connect Cloudflare", () => {
    const root = document.createElement("div");
    mountAccountView(root, viewPort(stateOf({ available: false, on: false, busy: false })));
    expect(switchOf(root).disabled).toBe(true);
    expect(root.textContent).not.toContain("Connect Cloudflare first");
  });

  it("7.1a drops the Coming soon placeholder text and shows the switch description", () => {
    const root = document.createElement("div");
    mountAccountView(root, viewPort(stateOf({ available: true, on: false, busy: false })));
    expect(root.textContent).not.toContain("Coming soon: open your library from any browser");
    expect(root.textContent).toContain("Open your library read-only from labshelf.org/open/ after signing in with this Cloudflare account.");
  });

  it("7.1b enables the switch when remote access is available and shows its value", () => {
    const root = document.createElement("div");
    const port = viewPort(stateOf({ available: true, on: true, busy: false }));
    mountAccountView(root, port);
    expect(switchOf(root).disabled).toBe(false);
    expect(switchOf(root).checked).toBe(true);
    port.push(stateOf({ available: true, on: false, busy: false }));
    expect(switchOf(root).checked).toBe(false);
  });

  it("7.1b toggling the switch asks the port to turn remote access on", () => {
    const root = document.createElement("div");
    const port = viewPort(stateOf({ available: true, on: false, busy: false }));
    mountAccountView(root, port);
    switchOf(root).click();
    expect(port.remoteCalls).toEqual([true]);
  });

  it("7.1b toggling an on switch asks the port to turn remote access off", () => {
    const root = document.createElement("div");
    const port = viewPort(stateOf({ available: true, on: true, busy: false }));
    mountAccountView(root, port);
    switchOf(root).click();
    expect(port.remoteCalls).toEqual([false]);
  });

  it("7.1b disables the switch while busy and enables it again after the new value arrives", () => {
    const root = document.createElement("div");
    const port = viewPort(stateOf({ available: true, on: false, busy: false }));
    mountAccountView(root, port);
    switchOf(root).click();
    port.push(stateOf({ available: true, on: false, busy: true }));
    expect(switchOf(root).disabled).toBe(true);
    port.push(stateOf({ available: true, on: true, busy: false }));
    expect(switchOf(root).disabled).toBe(false);
    expect(switchOf(root).checked).toBe(true);
  });

  it("7.1b shows the failure message and puts the switch back off", () => {
    const root = document.createElement("div");
    const port = viewPort(stateOf({ available: true, on: false, busy: false }));
    mountAccountView(root, port);
    switchOf(root).click();
    port.push(stateOf({ available: true, on: false, busy: true }));
    port.push(stateOf({ available: true, on: false, busy: false, message: "Could not reach Cloudflare" }));
    expect(switchOf(root).checked).toBe(false);
    expect(switchOf(root).disabled).toBe(false);
    expect(root.textContent).toContain("Could not reach Cloudflare");
  });

  it("7.1b hides the message once a state arrives without one", () => {
    const root = document.createElement("div");
    const port = viewPort(stateOf({ available: true, on: false, busy: false, message: "Could not reach Cloudflare" }));
    mountAccountView(root, port);
    expect(root.textContent).toContain("Could not reach Cloudflare");
    port.push(stateOf({ available: true, on: false, busy: false }));
    expect(root.textContent).not.toContain("Could not reach Cloudflare");
  });
});
