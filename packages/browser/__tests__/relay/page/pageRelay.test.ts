// When a share asks for the owner's relay: the connected account, a confirmed connect, a cancel and a failure.
import type { ILogger, RelayAccount } from "@labshelf/core";
import { requireRelay, type RequireRelayDeps } from "../../../src/relay/page/pageRelay";
import { RelaySignInCancelledError } from "../../../src/relay/watchRedirectTab";

const ACCOUNT: RelayAccount = {
  credential: { kind: "oauth" }, accountId: "acc", relayUrl: "https://labshelf-relay.owner.workers.dev", ownerSecret: "s", kvNamespaceId: "kv",
};

function fakeLogger(): ILogger & { log: jest.Mock; error: jest.Mock } {
  return { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger & { log: jest.Mock; error: jest.Mock };
}

function deps(over: Partial<RequireRelayDeps> = {}): RequireRelayDeps & { connect: jest.Mock; confirmConnect: jest.Mock; showFailure: jest.Mock } {
  return {
    relay: { account: jest.fn(async () => undefined), connect: jest.fn(async () => ACCOUNT.relayUrl) },
    confirmConnect: jest.fn(async () => true),
    showFailure: jest.fn(),
    logger: fakeLogger(),
    ...over,
  } as unknown as RequireRelayDeps & { connect: jest.Mock; confirmConnect: jest.Mock; showFailure: jest.Mock };
}

describe("requireRelay", () => {
  it("returns the connected account without asking", async () => {
    const d = deps({ relay: { account: async () => ACCOUNT, connect: jest.fn() } });
    await expect(requireRelay(d)).resolves.toBe(ACCOUNT);
    expect(d.confirmConnect).not.toHaveBeenCalled();
    expect(d.relay.connect).not.toHaveBeenCalled();
  });

  it("returns undefined and connects nothing when the owner cancels the offer", async () => {
    const d = deps({ confirmConnect: jest.fn(async () => false) });
    await expect(requireRelay(d)).resolves.toBeUndefined();
    expect(d.relay.connect).not.toHaveBeenCalled();
    expect(d.showFailure).not.toHaveBeenCalled();
  });

  it("connects after the owner confirms and returns the stored account", async () => {
    const account = jest.fn<Promise<RelayAccount | undefined>, []>().mockResolvedValueOnce(undefined).mockResolvedValueOnce(ACCOUNT);
    const d = deps({ relay: { account, connect: jest.fn(async () => ACCOUNT.relayUrl) } });
    await expect(requireRelay(d)).resolves.toBe(ACCOUNT);
    expect(d.relay.connect).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when the owner cancels at an account choice", async () => {
    const d = deps({ relay: { account: async () => undefined, connect: async () => undefined } });
    await expect(requireRelay(d)).resolves.toBeUndefined();
    expect(d.showFailure).not.toHaveBeenCalled();
  });

  it("logs and shows a failed connect, and returns undefined", async () => {
    const failure = new Error("Cloudflare refused the upload");
    const d = deps({ relay: { account: async () => undefined, connect: async () => { throw failure; } } });
    await expect(requireRelay(d)).resolves.toBeUndefined();
    expect((d.logger as unknown as { error: jest.Mock }).error).toHaveBeenCalledWith("relay", failure, expect.objectContaining({ action: "connect Cloudflare" }));
    expect(d.showFailure).toHaveBeenCalledWith(expect.stringContaining("Cloudflare refused the upload"));
  });

  it("only logs a sign-in the owner closed", async () => {
    const d = deps({ relay: { account: async () => undefined, connect: async () => { throw new RelaySignInCancelledError(); } } });
    await expect(requireRelay(d)).resolves.toBeUndefined();
    expect(d.showFailure).not.toHaveBeenCalled();
    expect((d.logger as unknown as { error: jest.Mock }).error).not.toHaveBeenCalled();
  });
});
