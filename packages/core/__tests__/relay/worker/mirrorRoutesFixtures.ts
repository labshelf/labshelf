// What the relay's /mirror/* route tests share: the relay env over a real Mirror, the Cloudflare /user stand-in, and the request helpers.
import { DatabaseSync } from "node:sqlite";
import type { RelayEnv } from "../../../src/relay/worker/index";
import { Mirror } from "../../../src/relay/worker/mirror";
import { answerMirrorRequest } from "../../../src/relay/worker/mirrorRoutes";
import { fakeBucket, fakeEnv, fakeMirrorState, OWNER_SECRET } from "./fakeRoomRuntime";

export const BASE = "https://relay.example.workers.dev";
export const HOUR = 3600 * 1000;
export const T0 = Date.UTC(2026, 10, 9, 12, 0, 0);
export const OWNER_EMAIL = "owner@example.com";
export const OWNER_TOKEN = "cf-token-of-the-owner-SECRET-0123456789";
export const OTHER_TOKEN = "cf-token-of-someone-else-SECRET-9876543210";
export const HASH = "a".repeat(64);
export const ownerAuth = { Authorization: `Bearer ${OWNER_SECRET}` };

/** A Cloudflare `/user` stand-in: each known token answers its account email, every other token is refused. */
function fakeUserApi(users: Record<string, string>) {
  const calls: { url: string; method: string; authorization: string | null }[] = [];
  const fetchFake = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input as string | Request, init);
    const authorization = request.headers.get("authorization");
    calls.push({ url: request.url, method: request.method, authorization });
    const email = users[(authorization ?? "").replace(/^Bearer /, "")];
    return email === undefined
      ? new Response(JSON.stringify({ success: false, errors: [{ code: 1000, message: "Invalid API Token" }], result: null }), { status: 401 })
      : new Response(JSON.stringify({ success: true, errors: [], result: { id: "u1", email } }), { status: 200 });
  }) as typeof fetch;
  return { fetch: fetchFake, calls };
}

/** The relay env with a real Mirror on in-memory SQLite behind MIRROR; `db` lets a test look at everything the Mirror keeps. */
export function mirrorSetup(users: Record<string, string> = { [OWNER_TOKEN]: OWNER_EMAIL, [OTHER_TOKEN]: "someone@else.org" }) {
  const db = new DatabaseSync(":memory:");
  const bucket = fakeBucket();
  const mirror = new Mirror(fakeMirrorState(db), { MIRROR_BUCKET: bucket });
  const env = {
    ...fakeEnv().env,
    MIRROR: { idFromName: (name: string) => name, get: () => ({ fetch: (request: Request) => mirror.fetch(request) }) },
  } as unknown as RelayEnv;
  const clock = { time: T0 };
  const userApi = fakeUserApi(users);
  const deps = { fetch: userApi.fetch, now: () => clock.time };
  return { db, env, clock, deps, userApi, bucket };
}

export type Setup = ReturnType<typeof mirrorSetup>;

export async function send(
  setup: Setup, method: string, path: string, options: { body?: unknown; headers?: Record<string, string>; env?: RelayEnv } = {},
): Promise<Response> {
  const body = options.body === undefined ? undefined : typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  const request = new Request(`${BASE}${path}`, { method, headers: options.headers ?? {}, ...(body === undefined ? {} : { body }) });
  const response = await answerMirrorRequest(request, options.env ?? setup.env, setup.deps);
  if (!response) { throw new Error(`answerMirrorRequest did not answer ${method} ${path}`); }
  return response;
}

export const jsonOf = async (response: Response): Promise<Record<string, unknown>> => (await response.json()) as Record<string, unknown>;

export async function setOwner(setup: Setup, email = OWNER_EMAIL): Promise<void> {
  expect((await send(setup, "PUT", "/mirror/owner", { body: { email }, headers: ownerAuth })).status).toBe(200);
}

export async function openSession(setup: Setup, token = OWNER_TOKEN): Promise<string> {
  const response = await send(setup, "POST", "/mirror/session", { body: { accessToken: token } });
  expect(response.status).toBe(200);
  const { session } = await jsonOf(response);
  expect(typeof session).toBe("string");
  return session as string;
}

export const bearer = (session: string) => ({ Authorization: `Bearer ${session}` });

export const row = (path: string, value: string, kind = "notes") => ({ path, kind, hash: HASH, size: value.length, value });

export const putRows = (setup: Setup, rows: ReturnType<typeof row>[], headers: Record<string, string> = ownerAuth) =>
  send(setup, "POST", "/mirror/rows", { body: { put: rows, delete: [] }, headers });

/** Every string under a `path` key anywhere in the answer, whatever envelope the listing comes in. */
export function pathsIn(value: unknown): string[] {
  if (Array.isArray(value)) { return value.flatMap(pathsIn); }
  if (typeof value !== "object" || value === null) { return []; }
  return Object.entries(value).flatMap(([key, item]) => (key === "path" && typeof item === "string" ? [item] : pathsIn(item)));
}

export async function indexedPaths(setup: Setup, session: string): Promise<string[]> {
  const response = await send(setup, "GET", "/mirror/index", { headers: bearer(session) });
  expect(response.status).toBe(200);
  return pathsIn(await response.json());
}

export const flipMiddle = (text: string): string => {
  const at = Math.floor(text.length / 2);
  return `${text.slice(0, at)}${text[at] === "A" ? "B" : "A"}${text.slice(at + 1)}`;
};
