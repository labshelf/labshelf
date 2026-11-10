// Finds the owner's Worker through the directory, opens a mirror session on it and reads the Mirror's index and files.
import { createDirectoryClient, DirectoryError } from "@labshelf/core";

export type OpenState = { kind: "ready"; client: RemoteLibraryClient } | { kind: "off" } | { kind: "other_account" } | { kind: "not_registered" } | { kind: "failed"; message: string }
interface RemoteLibraryClient { index(): Promise<{ path: string; kind: string; size: number; updated: number }[]>; file(path: string): Promise<string> }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const failed = (message: string): OpenState => ({ kind: "failed", message });

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return undefined; }
}

function createClient(relayUrl: string, session: string, doFetch: typeof fetch): RemoteLibraryClient {
  const base = relayUrl.replace(/\/+$/, "");
  const read = async (path: string): Promise<Response> => {
    const response = await doFetch(`${base}${path}`, { method: "GET", headers: { authorization: `Bearer ${session}` } });
    if (!response.ok) { throw new Error(`The Mirror refused the read (${response.status}).`); }
    return response;
  };
  return {
    async index() {
      const answer = await readJson(await read("/mirror/index"));
      const rows = Array.isArray(answer) ? answer : isRecord(answer) && Array.isArray(answer["rows"]) ? answer["rows"] : undefined;
      if (!rows) { throw new Error("The Mirror's index is not readable."); }
      return rows.filter(isRecord).map((row) => ({
        path: String(row["path"]), kind: String(row["kind"]), size: Number(row["size"]), updated: Number(row["updated"]),
      }));
    },
    async file(path) {
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      return (await read(`/mirror/file/${encoded}`)).text();
    },
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
