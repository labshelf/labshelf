/** Pins the Cloudflare client of the relay: token verification, account listing, deploy, update, removal and the wait for the address. */
import {
  assertRelayServing, CloudflareApiError, createCloudflareClient, deployRelay, listCloudflareAccounts, removeRelay, updateRelayIfOlder,
  verifyCloudflareToken, type RelayClock,
} from "../../src/relay/index";
import { ACCOUNT, TOKEN, fakeCloudflare, metadataOf, recordingLogger } from "./fakeCloudflare";

const clientFor = (token: string, options: Parameters<typeof fakeCloudflare>[0] = {}) => {
  const cloudflare = fakeCloudflare(options);
  const logger = recordingLogger();
  return { client: createCloudflareClient({ token, fetch: cloudflare.fetch, logger }), logger, ...cloudflare };
};

describe("Cloudflare token and accounts", () => {
  it("accepts an active token and lists its accounts", async () => {
    const { client } = clientFor(TOKEN);
    await expect(verifyCloudflareToken(client)).resolves.toBeUndefined();
    await expect(listCloudflareAccounts(client)).resolves.toEqual([{ id: ACCOUNT, name: "Lab" }]);
  });

  it("accepts an account-owned token whose user endpoint is refused but whose accounts list", async () => {
    const { client } = clientFor(TOKEN, { accountOwnedToken: true });
    await expect(verifyCloudflareToken(client)).resolves.toBeUndefined();
  });

  it("turns a bad token into a readable typed error without logging the token", async () => {
    const { client, logger } = clientFor("wrong-token-xyz", { validToken: TOKEN });
    const error = await verifyCloudflareToken(client).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudflareApiError);
    expect(error).toMatchObject({ status: 401, code: 1000, cloudflareMessage: "Invalid API Token" });
    expect((error as Error).message).toMatch(/rejected the API token.*paste it whole/);
    expect(JSON.stringify(logger.calls)).not.toContain("wrong-token-xyz");
  });

  it("reports an expired token as rejected", async () => {
    const fetchStub = (async () => new Response(JSON.stringify({ success: true, result: { status: "expired" } }), { status: 200 })) as typeof fetch;
    const client = createCloudflareClient({ token: TOKEN, fetch: fetchStub, logger: recordingLogger() });
    await expect(verifyCloudflareToken(client)).rejects.toThrow(/the token is expired/);
  });

  it("reports a network failure with status 0", async () => {
    const fetchStub = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    const client = createCloudflareClient({ token: TOKEN, fetch: fetchStub, logger: recordingLogger() });
    await expect(client.call("GET", "/accounts")).rejects.toMatchObject({ status: 0, message: expect.stringContaining("Could not reach Cloudflare") });
  });

  it("reports a non-JSON error body", async () => {
    const fetchStub = (async () => new Response("<html>bad gateway</html>", { status: 502 })) as typeof fetch;
    const client = createCloudflareClient({ token: TOKEN, fetch: fetchStub, logger: recordingLogger() });
    await expect(client.call("GET", "/accounts")).rejects.toMatchObject({ status: 502, message: expect.stringContaining("bad gateway") });
  });

  it("treats a JSON array body like any other non-object: it is the result, and on failure only the status is read", async () => {
    const okStub = (async () => new Response("[]", { status: 200 })) as typeof fetch;
    const okClient = createCloudflareClient({ token: TOKEN, fetch: okStub, logger: recordingLogger() });
    await expect(okClient.call("GET", "/accounts")).resolves.toEqual([]);
    const failStub = (async () => new Response('[{"code":1000,"message":"x"}]', { status: 502 })) as typeof fetch;
    const failClient = createCloudflareClient({ token: TOKEN, fetch: failStub, logger: recordingLogger() });
    await expect(failClient.call("GET", "/accounts")).rejects.toMatchObject({ status: 502, code: 0 });
  });
});

const script = "export default { fetch() { return new Response('ok'); } };";

async function deploy(options: Parameters<typeof fakeCloudflare>[0] = {}) {
  const cloudflare = fakeCloudflare(options);
  const logger = recordingLogger();
  const result = await deployRelay({ token: TOKEN, accountId: ACCOUNT, script, workerName: "relay", logger, fetch: cloudflare.fetch });
  return { ...cloudflare, logger, result };
}

describe("deployRelay", () => {
  it("sends the recipe's requests in order on a fresh account", async () => {
    const { requests } = await deploy();
    expect(requests.map((r) => `${r.method} ${r.path.replace(ACCOUNT, "<A>")}`)).toEqual([
      "GET /accounts/<A>/storage/kv/namespaces?per_page=100",
      "POST /accounts/<A>/storage/kv/namespaces",
      "GET /accounts/<A>/workers/subdomain",
      "PUT /accounts/<A>/workers/subdomain",
      "PUT /accounts/<A>/workers/scripts/relay",
      "PUT /accounts/<A>/workers/scripts/relay/secrets",
      "POST /accounts/<A>/workers/scripts/relay/subdomain",
    ]);
    expect(requests.every((r) => r.headers.Authorization === `Bearer ${TOKEN}`)).toBe(true);
  });

  it("skips creating the subdomain when the account has one", async () => {
    const { requests, result } = await deploy({ hasSubdomain: true });
    expect(requests.some((r) => r.method === "PUT" && r.path.endsWith("/workers/subdomain"))).toBe(false);
    expect(result.relayUrl).toBe("https://relay.lab.workers.dev");
  });

  it("derives a valid subdomain label from the account id", async () => {
    const { requests, result } = await deploy();
    const created = requests.find((r) => r.method === "PUT" && r.path.endsWith("/workers/subdomain"))!.json as { subdomain: string };
    expect(created.subdomain).toBe("labshelf-a1b2c3d4e5f6");
    expect(result.relayUrl).toBe("https://relay.labshelf-a1b2c3d4e5f6.workers.dev");
  });

  it("uploads multipart with the bindings, kept secrets and first-upload migrations", async () => {
    const { requests } = await deploy();
    const upload = requests.find((r) => r.path.endsWith("/workers/scripts/relay"))!;
    expect(await metadataOf(upload)).toEqual({
      main_module: "worker.js",
      compatibility_date: "2026-10-01",
      bindings: [
        { type: "durable_object_namespace", name: "ROOM", class_name: "Room" },
        { type: "kv_namespace", name: "KV", namespace_id: "kv-1" },
      ],
      keep_bindings: ["secret_text"],
      migrations: { new_tag: "v1", new_sqlite_classes: ["Room"] },
    });
    const metadataPart = upload.form!.get("metadata") as Blob;
    const scriptPart = upload.form!.get("worker.js") as File;
    expect(metadataPart.type).toBe("application/json");
    expect(scriptPart.type).toBe("application/javascript+module");
    expect(scriptPart.name).toBe("worker.js");
    expect(await scriptPart.text()).toBe(script);
  });

  it("sets the owner secret as a secret, and returns what the caller keeps", async () => {
    const { requests, result } = await deploy();
    const secrets = requests.filter((r) => r.path.endsWith("/secrets")).map((r) => r.json);
    expect(secrets).toEqual([
      { name: "OWNER_SECRET", text: result.ownerSecret, type: "secret_text" },
    ]);
    expect(result.ownerSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(requests.find((r) => r.path.endsWith("/relay/subdomain"))!.json).toEqual({ enabled: true, previews_enabled: false });
    expect(result).toMatchObject({ kvNamespaceId: "kv-1" });
  });

  it("draws a different owner secret on every deploy", async () => {
    const [first, second] = [await deploy(), await deploy()];
    expect(first.result.ownerSecret).not.toBe(second.result.ownerSecret);
  });

  it("never logs the token, or the owner secret", async () => {
    const { logger, result } = await deploy();
    const logged = JSON.stringify(logger.calls);
    expect(logger.calls.length).toBeGreaterThan(5);
    for (const secret of [TOKEN, result.ownerSecret]) { expect(logged).not.toContain(secret); }
  });

  it("fails with a readable error and logs it without the token when the token is wrong", async () => {
    const cloudflare = fakeCloudflare({ validToken: "other" });
    const logger = recordingLogger();
    await expect(deployRelay({ token: TOKEN, accountId: ACCOUNT, script, workerName: "relay", logger, fetch: cloudflare.fetch }))
      .rejects.toMatchObject({ name: "CloudflareApiError", status: 401, code: 1000, message: expect.stringContaining("rejected the API token") });
    expect(JSON.stringify(logger.calls)).not.toContain(TOKEN);
    expect(logger.calls.some((call) => call[0] === "ERROR")).toBe(true);
  });

  it("explains a missing subdomain (10063) by its code", async () => {
    await expect(deploy({ failScriptUploadWith: { status: 403, code: 10063, message: "subdomain required" } }))
      .rejects.toMatchObject({ code: 10063, message: expect.stringContaining("workers.dev subdomain") });
  });

  describe("retried after a failed attempt", () => {
    it("reuses the KV namespace with the same title instead of creating another", async () => {
      const { requests, result } = await deploy({ existingKvNamespaces: [{ id: "other", title: "x" }, { id: "kv-old", title: "labshelf-relay-relay" }] });
      expect(requests.some((r) => r.method === "POST" && r.path.endsWith("/storage/kv/namespaces"))).toBe(false);
      expect(result.kvNamespaceId).toBe("kv-old");
      expect(await metadataOf(requests.find((r) => r.path.endsWith("/workers/scripts/relay"))!)).toMatchObject({
        bindings: expect.arrayContaining([{ type: "kv_namespace", name: "KV", namespace_id: "kv-old" }]),
      });
    });

    it("retries a taken subdomain name once with a random suffix", async () => {
      const { requests, result } = await deploy({ takenSubdomain: "labshelf-a1b2c3d4e5f6" });
      const puts = requests.filter((r) => r.method === "PUT" && r.path.endsWith("/workers/subdomain")).map((r) => (r.json as { subdomain: string }).subdomain);
      expect(puts).toHaveLength(2);
      expect(puts[1]).toMatch(/^labshelf-a1b2c3d4e5f6-[0-9a-f]{6}$/);
      expect(result.relayUrl).toBe(`https://relay.${puts[1]}.workers.dev`);
    });
  });
});

const base = { token: TOKEN, accountId: ACCOUNT, workerName: "relay", kvNamespaceId: "kv-1" };

describe("removeRelay", () => {
  it("deletes the Worker and the KV namespace", async () => {
    const cloudflare = fakeCloudflare();
    await removeRelay({ ...base, logger: recordingLogger(), fetch: cloudflare.fetch });
    expect(cloudflare.requests.map((r) => `${r.method} ${r.path.replace(ACCOUNT, "<A>")}`)).toEqual([
      "DELETE /accounts/<A>/workers/scripts/relay?force=true",
      "DELETE /accounts/<A>/storage/kv/namespaces/kv-1",
    ]);
  });

  it("treats a missing resource as deleted and still deletes the rest", async () => {
    const calls: string[] = [];
    const fetchStub = (async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url}`);
      return url.includes("/workers/scripts/") ? new Response(JSON.stringify({ success: false, errors: [{ code: 10007, message: "gone" }] }), { status: 404 })
        : new Response(JSON.stringify({ success: true, result: {} }), { status: 200 });
    }) as unknown as typeof fetch;
    await removeRelay({ ...base, logger: recordingLogger(), fetch: fetchStub });
    expect(calls).toHaveLength(2);
  });

  it("tries every deletion and then throws the first real failure", async () => {
    const calls: string[] = [];
    const fetchStub = (async (url: string) => {
      calls.push(url);
      return url.includes("kv/namespaces") ? new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }), { status: 403 })
        : new Response(JSON.stringify({ success: true, result: {} }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(removeRelay({ ...base, logger: recordingLogger(), fetch: fetchStub })).rejects.toMatchObject({ code: 10000 });
    expect(calls).toHaveLength(2);
  });
});

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

function fakeClock(): RelayClock & { sleeps: number[] } {
  let time = 0;
  const sleeps: number[] = [];
  return { sleeps, now: () => time, async sleep(ms) { sleeps.push(ms); time += ms; } };
}

describe("assertRelayServing", () => {
  it("retries through TLS failures, backing off, until /version answers", async () => {
    const clock = fakeClock();
    let calls = 0;
    const fetchStub = (async () => {
      calls += 1;
      if (calls < 5) { throw new TypeError("TLS handshake failure"); }
      return new Response(JSON.stringify({ v: "1.0", worker: "1.0.0" }), { status: 200 });
    }) as typeof fetch;
    await assertRelayServing({ relayUrl: "https://relay.lab.workers.dev", fetch: fetchStub, logger: recordingLogger(), clock });
    expect(calls).toBe(5);
    expect(clock.sleeps).toEqual([5000, 7500, 11250, 15000]);
  });

  it("gives up with a readable error after the timeout", async () => {
    const clock = fakeClock();
    const fetchStub = (async () => { throw new TypeError("TLS handshake failure"); }) as typeof fetch;
    await expect(assertRelayServing({ relayUrl: "https://r.w.dev", fetch: fetchStub, logger: recordingLogger(), clock, timeoutMs: 30_000 }))
      .rejects.toThrow(/did not answer within 30 s/);
    expect(clock.now()).toBeLessThanOrEqual(30_000);
  });
});
