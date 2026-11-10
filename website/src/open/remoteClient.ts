// Finds the owner's Worker through the directory, opens a mirror session on it, reads the Mirror's index and files and sends the page's edits.
import { createDirectoryClient, DirectoryError } from "@labshelf/core";

export type OpenState = { kind: "ready"; client: RemoteLibraryClient } | { kind: "off" } | { kind: "other_account" } | { kind: "not_registered" } | { kind: "failed"; message: string }

/** One row of the Mirror's index; `hash` is the SHA-256 hex of the row's bytes. */
interface MirrorIndexRow { path: string; kind: string; hash: string; size: number; updated: number }

/** What an edit answers: the row's new hash, or a conflict with the hash the Mirror holds now. */
export type EditAnswer = { ok: true; hash: string } | { ok: false; conflict: true; hash: string };

/**
 * The Mirror as the page reads and edits it. INVARIANT: the client keeps the hash it last saw per path (from the index and every
 * accepted edit), so a caller passes `hashOf(path)` as the base of its next edit; a conflict leaves the kept hash as it was.
 */
export interface RemoteLibraryClient {
  index(): Promise<MirrorIndexRow[]>;
  file(path: string): Promise<string>;
  bytes(path: string): Promise<Uint8Array>;
  /** The hash last seen for `path`; "" for a path the Mirror does not hold. */
  hashOf(path: string): string;
  write(path: string, data: string | Uint8Array, base: string): Promise<EditAnswer>;
  remove(path: string, base: string): Promise<EditAnswer>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const failed = (message: string): OpenState => ({ kind: "failed", message });
const encodePath = (path: string): string => path.split("/").map(encodeURIComponent).join("/");

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return undefined; }
}

/** The text a refused edit throws; a conflict is answered, not thrown. */
function editRefusal(status: number, error: unknown): string {
  if (error === "full") { return "Your remote library is full. Open LabShelf on your computer to make room."; }
  if (error === "tooLarge") { return "This file is too large for the remote library."; }
  return `The Mirror refused the edit (${status}).`;
}

function createClient(relayUrl: string, session: string, doFetch: typeof fetch): RemoteLibraryClient {
  const base = relayUrl.replace(/\/+$/, "");
  const hashes = new Map<string, string>();
  const authorization = `Bearer ${session}`;
  const read = async (path: string): Promise<Response> => {
    const response = await doFetch(`${base}/mirror/file/${encodePath(path)}`, { method: "GET", headers: { authorization } });
    if (!response.ok) { throw new Error(`The Mirror refused the read (${response.status}).`); }
    return response;
  };
  const edit = async (method: "PUT" | "DELETE", path: string, baseHash: string, body?: string | Uint8Array): Promise<EditAnswer> => {
    const response = await doFetch(`${base}/mirror/edit/${encodePath(path)}`, {
      method, headers: { authorization, "x-labshelf-base": baseHash }, ...(body === undefined ? {} : { body: body as BodyInit }),
    });
    const answer = await readJson(response);
    const error = isRecord(answer) ? answer["error"] : undefined;
    const hash = isRecord(answer) && typeof answer["hash"] === "string" ? answer["hash"] : "";
    if (response.status === 409 && error === "conflict") { return { ok: false, conflict: true, hash }; }
    if (!response.ok) { throw new Error(editRefusal(response.status, error)); }
    const kept = method === "DELETE" ? "" : hash;
    hashes.set(path, kept);
    return { ok: true, hash: kept };
  };
  return {
    async index() {
      const response = await doFetch(`${base}/mirror/index`, { method: "GET", headers: { authorization } });
      if (!response.ok) { throw new Error(`The Mirror refused the read (${response.status}).`); }
      const answer = await readJson(response);
      const rows = Array.isArray(answer) ? answer : isRecord(answer) && Array.isArray(answer["rows"]) ? answer["rows"] : undefined;
      if (!rows) { throw new Error("The Mirror's index is not readable."); }
      const listed = rows.filter(isRecord).map((row) => ({
        path: String(row["path"]), kind: String(row["kind"]), hash: typeof row["hash"] === "string" ? row["hash"] : "",
        size: Number(row["size"]), updated: Number(row["updated"]),
      }));
      for (const row of listed) { hashes.set(row.path, row.hash); }
      return listed;
    },
    async file(path) { return (await read(path)).text(); },
    async bytes(path) { return new Uint8Array(await (await read(path)).arrayBuffer()); },
    hashOf: (path) => hashes.get(path) ?? "",
    write: (path, data, baseHash) => edit("PUT", path, baseHash, data),
    remove: (path, baseHash) => edit("DELETE", path, baseHash),
  };
}

export async function openRemoteLibrary(accessToken: string, deps: { fetch: typeof fetch }): Promise<OpenState> {
  let relayUrl: string | undefined;
  try {
    relayUrl = await createDirectoryClient({ accessToken: async () => accessToken, fetch: deps.fetch }).self();
  } catch (error) {
    return failed(error instanceof DirectoryError ? error.message : "The LabShelf directory cannot be reached right now.");
  }
  if (relayUrl === undefined) { return { kind: "not_registered" }; }
  let response: Response;
  try {
    response = await deps.fetch(`${relayUrl.replace(/\/+$/, "")}/mirror/session`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken }),
    });
  } catch {
    return failed("Your LabShelf relay cannot be reached right now.");
  }
  const answer = await readJson(response);
  const error = isRecord(answer) ? answer["error"] : undefined;
  if (error === "off") { return { kind: "off" }; }
  if (error === "other_account") { return { kind: "other_account" }; }
  if (response.ok && isRecord(answer) && typeof answer["session"] === "string") {
    return { kind: "ready", client: createClient(relayUrl, answer["session"], deps.fetch) };
  }
  return failed(error === "unauthorized" ? "Cloudflare did not accept your sign-in." : error === "rateLimited" ? "Too many sign-ins for now; try again later." : "Your LabShelf relay refused the sign-in.");
}
