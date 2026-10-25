/** Pins the first-deploy request sequence, the secrets it sets and that nothing secret is logged. */
import { deployRelay } from "../../../src/relay/index";
import { ACCOUNT, TOKEN, fakeCloudflare, metadataOf, recordingLogger } from "./fakeCloudflare";

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
