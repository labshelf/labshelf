/** Pins disconnecting (withdraw, then delete, then forget) and the start-up update of the owner's relay. */
import { removeRelayAccount, updateOwnRelay } from "../../../src/relay/index";
import { accountWorld, connectedAccount, routes, signIn, type WorldOptions } from "./fakeRelayAccount";

async function connected(options: WorldOptions = {}) {
  const world = accountWorld(options);
  signIn(world);
  await world.store.save(connectedAccount);
  const deletesWhenWithdrawn: string[][] = [];
  const withdrawFromShares = jest.fn(async () => { deletesWhenWithdrawn.push(routes(world).filter((route) => route.startsWith("DELETE"))); });
  const disconnect = () => removeRelayAccount({ ...world.deps, withdrawFromShares });
  return { world, withdrawFromShares, deletesWhenWithdrawn, disconnect };
}

describe("removeRelayAccount", () => {
  it("withdraws the relay from the shares before deleting it, then forgets the account", async () => {
    const run = await connected();
    expect(await run.disconnect()).toEqual({ accountId: connectedAccount.accountId, relayUrl: connectedAccount.relayUrl });
    expect(run.withdrawFromShares).toHaveBeenCalledWith(connectedAccount.relayUrl);
    expect(run.deletesWhenWithdrawn).toEqual([[]]);
    expect(routes(run.world).some((route) => route.startsWith("DELETE"))).toBe(true);
    expect(await run.world.store.get()).toBeUndefined();
    expect(run.world.slots.tokens.value).toBeUndefined();
  });

  it("keeps the account when the deletion fails, so it can be retried", async () => {
    const run = await connected({ failDeletes: true });
    await expect(run.disconnect()).rejects.toThrow();
    expect(await run.world.store.get()).toEqual(connectedAccount);
  });

  it("leaves the shares when the owner declines to sign in again", async () => {
    const run = await connected();
    run.world.slots.tokens.value = undefined;
    await expect(run.disconnect()).rejects.toMatchObject({ code: "not_signed_in" });
    expect(run.withdrawFromShares).not.toHaveBeenCalled();
    expect(await run.world.store.get()).toEqual(connectedAccount);
  });

  it("does nothing when no account is connected", async () => {
    const world = accountWorld();
    const withdrawFromShares = jest.fn(async () => undefined);
    expect(await removeRelayAccount({ ...world.deps, withdrawFromShares })).toBeUndefined();
    expect(withdrawFromShares).not.toHaveBeenCalled();
    expect(world.cloudflare.requests).toEqual([]);
  });
});

describe("updateOwnRelay", () => {
  it("does nothing without a connected account", async () => {
    const world = accountWorld();
    expect(await updateOwnRelay({ ...world.deps, script: "export default {}" })).toBeUndefined();
    expect(world.cloudflare.requests).toEqual([]);
  });

  it("reports the outcome for the connected relay", async () => {
    const run = await connected({ relayVersion: { v: "1.0", worker: "999.0.0" } });
    expect(await updateOwnRelay({ ...run.world.deps, script: "export default {}" })).toBe("deployedNewer");
  });
});
