/** Pins the two deletions of a disconnect, tolerance of already-deleted resources and error reporting. */
import { removeRelay } from "../../../src/relay/index";
import { ACCOUNT, TOKEN, fakeCloudflare, recordingLogger } from "./fakeCloudflare";

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
