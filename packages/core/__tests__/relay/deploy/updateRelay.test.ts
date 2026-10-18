/** Pins that an older relay is re-uploaded without migrations and that a current or newer one is left alone. */
import { updateRelayIfOlder } from "../../../src/relay/index";
import { ACCOUNT, TOKEN, fakeCloudflare, metadataOf, recordingLogger } from "./fakeCloudflare";

async function update(deployed: string, bundledVersion = "1.0.3") {
  let tokenAsks = 0;
  const accessToken = async () => { tokenAsks += 1; return TOKEN; };
  const cloudflare = fakeCloudflare({ hasSubdomain: true, relayVersion: { v: deployed.split(".").slice(0, 2).join("."), worker: deployed } });
  const logger = recordingLogger();
  const outcome = await updateRelayIfOlder({
    relayUrl: "https://relay.lab.workers.dev/", bundledVersion, accessToken, accountId: ACCOUNT,
    script: "// bundle", workerName: "relay", kvNamespaceId: "kv-1", logger, fetch: cloudflare.fetch,
  });
  return { ...cloudflare, logger, outcome, tokenAsks };
}

describe("updateRelayIfOlder", () => {
  it("re-uploads without migrations when the deployed build is older", async () => {
    const { requests, outcome, logger } = await update("1.0.2");
    expect(outcome).toBe("updated");
    expect(requests.map((r) => `${r.method} ${r.path.replace(ACCOUNT, "<A>")}`)).toEqual([
      "GET https://relay.lab.workers.dev/version",
      "PUT /accounts/<A>/workers/scripts/relay",
    ]);
    const metadata = await metadataOf(requests[1]!);
    expect(metadata).not.toHaveProperty("migrations");
    expect(metadata).toMatchObject({ keep_bindings: ["secret_text"], bindings: expect.arrayContaining([{ type: "kv_namespace", name: "KV", namespace_id: "kv-1" }]) });
    expect(requests[0]!.headers.Authorization).toBeUndefined();
    expect(JSON.stringify(logger.calls)).not.toContain(TOKEN);
  });

  it("updates across a higher minor and across a major", async () => {
    expect((await update("1.0.9", "1.1.0")).outcome).toBe("updated");
    expect((await update("1.9.9", "2.0.0")).outcome).toBe("updated");
  });

  it("does nothing, and neither asks for a token nor calls the Cloudflare API, when the builds are equal", async () => {
    const { requests, outcome, tokenAsks } = await update("1.0.3");
    expect(outcome).toBe("current");
    expect(requests).toHaveLength(1);
    expect(tokenAsks).toBe(0);
  });

  it("never downgrades: a newer deployed build is left alone and logged", async () => {
    for (const deployed of ["1.0.4", "1.1.0", "2.0.0"]) {
      const { requests, outcome, logger } = await update(deployed);
      expect(outcome).toBe("deployedNewer");
      expect(requests).toHaveLength(1);
      expect(logger.calls.some((call) => String(call[2]).includes("newer"))).toBe(true);
    }
  });

  it("compares patches numerically", async () => {
    expect((await update("1.0.9", "1.0.10")).outcome).toBe("updated");
    expect((await update("1.0.10", "1.0.9")).outcome).toBe("deployedNewer");
  });

  it("throws with context when /version has no valid build", async () => {
    const cloudflare = fakeCloudflare({ relayVersion: { v: "1.0" } });
    await expect(updateRelayIfOlder({
      relayUrl: "https://relay.lab.workers.dev", bundledVersion: "1.0.3", accessToken: async () => TOKEN, accountId: ACCOUNT, script: "", workerName: "relay",
      kvNamespaceId: "kv-1", logger: recordingLogger(), fetch: cloudflare.fetch,
    })).rejects.toThrow(/Could not read the relay's version/);
  });

  it("refuses a bundled version that is not major.minor.patch", async () => {
    await expect(update("1.0.0", "1.0")).rejects.toThrow(/not major.minor.patch/);
  });
});
