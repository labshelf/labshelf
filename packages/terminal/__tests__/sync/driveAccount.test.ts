import * as http from "node:http";

import { MemoryTokenStore } from "@labshelf/core/test-support/sync-fakes";

import { DriveAccount } from "../../src/sync/index";
import { cleanupTempDirs } from "../fixtures/library";
import { device } from "../fixtures/syncDevice";

afterEach(async () => {
  await cleanupTempDirs();
});

function httpGet(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    http.get(url, { agent: false, headers: { Connection: "close" } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); })
      .on("error", reject);
  });
}

describe("DriveAccount", () => {
  it("signs in through the loopback flow, then signs out and forgets the tokens, keeping the sync status in step", async () => {
    const tokens = new MemoryTokenStore();
    const calls: string[] = [];
    const authFetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      if (String(input).includes("/revoke")) { return new Response("", { status: 200 }); }
      return new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }), { status: 200 });
    }) as typeof fetch;
    const d = await device({ tokens, authFetch });
    const account = new DriveAccount(d.auth, d.sync, d.logger);
    expect(d.sync.status().state).toBe("disconnected");

    let browser: Promise<number> | undefined;
    await account.login({
      openBrowser: (url) => {
        const parsed = new URL(url);
        browser = httpGet(`${parsed.searchParams.get("redirect_uri")}/?code=abc&state=${parsed.searchParams.get("state")}`);
      },
    });
    expect(await browser).toBe(200);
    expect(d.sync.status().state).toBe("idle");
    expect(tokens.tokens).toMatchObject({ access_token: "new-access", refresh_token: "new-refresh" });
    expect(d.logs.map((l) => l.message)).toContain("Signed in to Google Drive");

    await account.logout();
    expect(d.sync.status().state).toBe("disconnected");
    expect(tokens.tokens).toBeNull();
    expect(calls.some((c) => c.startsWith("https://oauth2.googleapis.com/revoke?token=new-refresh"))).toBe(true);
    expect(d.logs.map((l) => l.message)).toContain("Signed out of Google Drive");
    expect((await d.sync.syncNow()).kind).toBe("skipped");
  });
});
