/** Test doubles for the Google OAuth flow: a recording fetch, token responses, a loopback GET and a scripted browser. */
import * as http from "node:http";

export interface Call { url: string; method: string | undefined; body: URLSearchParams }

/** A fetch that records every call and answers with `respond`. */
export function fakeFetch(respond: (call: Call) => Response | Promise<Response>): { fn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = { url: String(input), method: init?.method, body: new URLSearchParams(String(init?.body ?? "")) };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fn, calls };
}

export function tokenResponse(body: Record<string, unknown> = {}, status = 200): Response {
  return new Response(JSON.stringify({ access_token: "access-new", expires_in: 3600, ...body }), {
    status, headers: { "content-type": "application/json" },
  });
}

/** A plain GET that closes its connection (so no keep-alive socket outlives the test). */
export function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { agent: false, headers: { Connection: "close" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
  });
}

export interface Browser {
  urls: string[];
  statuses: number[];
  bodies: string[];
  done: Promise<void>;
  open: (url: string) => void;
}

/** An "openBrowser" that plays the user's browser: calls the redirect_uri with each path `visits` returns. */
export function scriptedBrowser(visits: (authUrl: URL) => string[]): Browser {
  const urls: string[] = [];
  const statuses: number[] = [];
  const bodies: string[] = [];
  let finish!: () => void;
  let fail!: (e: unknown) => void;
  const done = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  return {
    urls, statuses, bodies, done,
    open(url: string) {
      urls.push(url);
      void (async () => {
        const authUrl = new URL(url);
        const redirect = authUrl.searchParams.get("redirect_uri")!;
        for (const suffix of visits(authUrl)) {
          const res = await httpGet(`${redirect}${suffix}`);
          statuses.push(res.status);
          bodies.push(res.body);
        }
      })().then(finish, fail);
    },
  };
}

/** The visit that completes a login: the redirect with a code and the URL's own state. */
export function redirectWithCode(code: string): (authUrl: URL) => string[] {
  return (authUrl) => [`/?code=${code}&state=${authUrl.searchParams.get("state")}`];
}
